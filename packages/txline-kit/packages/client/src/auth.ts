/** Auth manager: guest JWT + on-chain subscribe + API-token activation.
 *  Direct port of tx-on-chain/examples/devnet/common/users.ts (see VERIFIED.md).
 *
 *  Credential sources, in priority order:
 *   1. env TXLINE_JWT / TXLINE_API_TOKEN (manual escape hatch)
 *   2. persisted ~/.txline-kit/creds-<network>.json
 *   3. full activation flow (requires funded wallet keypair)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { TxlineAuthError } from "./errors.js";
import type { NetworkConfig } from "./networks.js";

export interface AuthOptions {
  network: NetworkConfig;
  wallet?: Keypair;
  serviceLevel?: number;
  weeks?: number;
  leagues?: number[];
  rpcUrl?: string;
  credsDir?: string;
}

interface PersistedCreds {
  jwt?: string;
  apiToken?: string;
  walletPubkey?: string;
  activatedAt?: number;
}

export class AuthManager {
  jwt = "";
  apiToken = "";
  private renewing: Promise<string> | null = null;
  private readonly credsFile: string;

  constructor(private readonly opts: AuthOptions) {
    const dir = opts.credsDir ?? path.join(os.homedir(), ".txline-kit");
    this.credsFile = path.join(dir, `creds-${opts.network.name}.json`);
    this.jwt = process.env.TXLINE_JWT ?? "";
    this.apiToken = process.env.TXLINE_API_TOKEN ?? "";
    if (!this.apiToken) {
      const saved = this.load();
      if (saved?.apiToken) {
        this.apiToken = saved.apiToken;
        if (!this.jwt && saved.jwt) this.jwt = saved.jwt;
      }
    }
  }

  headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.jwt) h["Authorization"] = `Bearer ${this.jwt}`;
    if (this.apiToken) h["X-Api-Token"] = this.apiToken;
    return h;
  }

  /** POST /auth/guest/start — single-flight so concurrent 401s renew once. */
  async renewJwt(): Promise<string> {
    if (this.renewing) return this.renewing;
    this.renewing = (async () => {
      try {
        const res = await fetch(this.opts.network.authUrl, { method: "POST" });
        if (!res.ok) {
          throw new TxlineAuthError(
            `Guest session failed: HTTP ${res.status} from ${this.opts.network.authUrl}`,
          );
        }
        const body = (await res.json()) as { token?: string };
        if (!body.token) throw new TxlineAuthError("Guest session returned no token");
        this.jwt = body.token;
        this.persist();
        return this.jwt;
      } finally {
        this.renewing = null;
      }
    })();
    return this.renewing;
  }

  /** Idempotent: reuses a persisted API token, otherwise runs the full
   *  guest → subscribe(serviceLevel, weeks) → activate flow on-chain. */
  async ensureActivated(): Promise<void> {
    if (this.apiToken) {
      if (!this.jwt) await this.renewJwt();
      return;
    }
    const wallet = this.opts.wallet;
    if (!wallet) {
      throw new TxlineAuthError(
        "No API token available and no wallet provided. Pass `wallet` (a funded " +
          `${this.opts.network.name} Keypair) or set TXLINE_API_TOKEN.`,
      );
    }
    if (!this.jwt) await this.renewJwt();

    const txSig = await this.subscribeOnChain(wallet);
    await this.activate(txSig, wallet);
    this.persist();
  }

  /** Anchor `subscribe` per VERIFIED.md; returns the confirmed tx signature. */
  private async subscribeOnChain(wallet: Keypair): Promise<string> {
    // Dynamic imports keep anchor/spl-token out of the hot path for consumers
    // that only ever use a pre-activated token (e.g. replay mode).
    const anchor = await import("@coral-xyz/anchor");
    const web3 = await import("@solana/web3.js");
    const spl = await import("@solana/spl-token");
    const { loadTxoracleIdl } = await import("./proofs.js");

    const cfg = this.opts.network;
    const serviceLevel = this.opts.serviceLevel ?? cfg.freeServiceLevel;
    const weeks = this.opts.weeks ?? 4;
    if (weeks < 4 || weeks % 4 !== 0) {
      throw new TxlineAuthError(`Subscription weeks must be a multiple of 4, got ${weeks}`);
    }

    const connection = new web3.Connection(this.opts.rpcUrl ?? cfg.defaultRpcUrl, "confirmed");
    const balance = await connection.getBalance(wallet.publicKey);
    if (balance === 0) {
      throw new TxlineAuthError(
        `Wallet ${wallet.publicKey.toBase58()} has 0 SOL on ${cfg.name}; it must pay ` +
          `transaction fees + rent. Fund it (devnet: https://faucet.solana.com) and retry.`,
      );
    }

    // Plain wallet-interface object, not `new anchor.Wallet(wallet)`: Anchor's
    // Wallet class doesn't survive some ESM/webpack bundling (e.g. Next.js on
    // Vercel) — "Wallet is not a constructor" at runtime. This provider only
    // ever signs the subscribe tx below, so a minimal object satisfying
    // AnchorProvider's wallet interface is all that's needed.
    const providerWallet = {
      publicKey: wallet.publicKey,
      signTransaction: async <T>(tx: T) => {
        (tx as unknown as { partialSign: (...s: InstanceType<typeof web3.Keypair>[]) => void }).partialSign(wallet);
        return tx;
      },
      signAllTransactions: async <T>(txs: T[]) => {
        for (const tx of txs) {
          (tx as unknown as { partialSign: (...s: InstanceType<typeof web3.Keypair>[]) => void }).partialSign(wallet);
        }
        return txs;
      },
    };
    const provider = new anchor.AnchorProvider(
      connection,
      providerWallet as never,
      anchor.AnchorProvider.defaultOptions(),
    );
    const program = new anchor.Program(loadTxoracleIdl(cfg.name as "devnet" | "mainnet"), provider);

    const tokenMint = new web3.PublicKey(cfg.tokenMint);
    const userTokenAccountAddress = spl.getAssociatedTokenAddressSync(
      tokenMint, wallet.publicKey, false, spl.TOKEN_2022_PROGRAM_ID,
    );

    // Create the user's Token-2022 ATA if missing (free tier still needs the account).
    const accountInfo = await connection.getAccountInfo(userTokenAccountAddress);
    if (!accountInfo) {
      const createTx = new web3.Transaction().add(
        spl.createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          userTokenAccountAddress,
          wallet.publicKey,
          tokenMint,
          spl.TOKEN_2022_PROGRAM_ID,
          spl.ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      await web3.sendAndConfirmTransaction(connection, createTx, [wallet], {
        commitment: "confirmed",
      });
    }

    const [pricingMatrixPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pricing_matrix")], program.programId,
    );
    const [tokenTreasuryPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("token_treasury_v2")], program.programId,
    );
    const tokenTreasuryVault = spl.getAssociatedTokenAddressSync(
      tokenMint, tokenTreasuryPda, true, spl.TOKEN_2022_PROGRAM_ID,
    );

    const tx: InstanceType<typeof web3.Transaction> = await (program.methods as any)
      .subscribe(serviceLevel, weeks)
      .accounts({
        user: wallet.publicKey,
        pricingMatrix: pricingMatrixPda,
        tokenMint,
        userTokenAccount: userTokenAccountAddress,
        tokenTreasuryVault,
        tokenTreasuryPda,
        tokenProgram: spl.TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .transaction();

    const latest = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = wallet.publicKey;
    tx.sign(wallet);
    const txSig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(
      { signature: txSig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed",
    );
    return txSig;
  }

  /** POST /api/token/activate with detached signature over "txSig:leagues:jwt". */
  private async activate(txSig: string, wallet: Keypair): Promise<void> {
    const leagues = this.opts.leagues ?? [];
    const message = `${txSig}:${leagues.join(",")}:${this.jwt}`;
    const signature = nacl.sign.detached(new TextEncoder().encode(message), wallet.secretKey);
    const walletSignature = Buffer.from(signature).toString("base64");

    const res = await fetch(`${this.opts.network.apiBase}/token/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.jwt}` },
      body: JSON.stringify({ txSig, walletSignature, leagues }),
    });
    const bodyText = await res.text();
    if (!res.ok) {
      throw new TxlineAuthError(`Activation failed (HTTP ${res.status}): ${bodyText.slice(0, 300)}`);
    }
    let token = bodyText;
    try {
      const parsed = JSON.parse(bodyText) as { token?: string };
      if (parsed && typeof parsed === "object" && parsed.token) token = parsed.token;
    } catch {
      /* raw token body */
    }
    if (!token) throw new TxlineAuthError("Activation returned an empty token");
    this.apiToken = token;
  }

  private load(): PersistedCreds | null {
    try {
      return JSON.parse(fs.readFileSync(this.credsFile, "utf8")) as PersistedCreds;
    } catch {
      return null;
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.credsFile), { recursive: true });
      const creds: PersistedCreds = {
        jwt: this.jwt,
        apiToken: this.apiToken,
        walletPubkey: this.opts.wallet?.publicKey.toBase58(),
        activatedAt: Date.now(),
      };
      fs.writeFileSync(this.credsFile, JSON.stringify(creds, null, 2), { mode: 0o600 });
    } catch {
      /* persistence is best-effort */
    }
  }
}
