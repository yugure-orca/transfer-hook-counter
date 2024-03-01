import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TransferHookCounter } from "../target/types/transfer_hook_counter";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  Keypair,
} from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  createTransferCheckedWithTransferHookInstruction,
  getExtraAccountMetas
} from "@solana/spl-token";

describe("transfer-hook-counter", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TransferHookCounter as Program<TransferHookCounter>;
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  // Generate keypair to use as address for the transfer-hook enabled mint
  const mint = new Keypair();
  const decimals = 9;

  // Sender token account address
  const sourceTokenAccount = getAssociatedTokenAddressSync(
    mint.publicKey,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // Recipient token account address
  const recipient = Keypair.generate();
  const destinationTokenAccount = getAssociatedTokenAddressSync(
    mint.publicKey,
    recipient.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // ExtraAccountMetaList address
  // Store extra accounts required by the custom transfer hook instruction
  const [extraAccountMetaListPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.publicKey.toBuffer()],
    program.programId
  );
  
  const [counterPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), mint.publicKey.toBuffer()],
    program.programId
  );

  it("Create Mint Account with Transfer Hook Extension", async () => {
    const extensions = [ExtensionType.TransferHook];
    const mintLen = getMintLen(extensions);
    const lamports =
      await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mint.publicKey,
        space: mintLen,
        lamports: lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferHookInstruction(
        mint.publicKey,
        wallet.publicKey,
        program.programId, // Transfer Hook Program ID
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mint.publicKey,
        decimals,
        wallet.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );

    const txSig = await sendAndConfirmTransaction(
      provider.connection,
      transaction,
      [wallet.payer, mint],
      { skipPreflight: true, commitment: "confirmed"}
    );

    console.log(`Transaction Signature: ${txSig}`);
  });

  // Create the two token accounts for the transfer-hook enabled mint
  // Fund the sender token account with 100 tokens
  it("Create Token Accounts and Mint Tokens", async () => {
    // 100 tokens
    const amount = 100 * 10 ** decimals;

    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        sourceTokenAccount,
        wallet.publicKey,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        destinationTokenAccount,
        recipient.publicKey,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
      createMintToInstruction(
        mint.publicKey,
        sourceTokenAccount,
        wallet.publicKey,
        amount,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );

    const txSig = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet.payer],
      { skipPreflight: true, commitment: "confirmed"}
    );

    console.log(`Transaction Signature: ${txSig}`);
  });

  // Account to store extra accounts required by the transfer hook instruction
  it("Create ExtraAccountMetaList Account", async () => {
    const extraAccountMetasInfo = await connection.getAccountInfo(extraAccountMetaListPDA);
    
    console.log("Extra accounts meta: " + extraAccountMetasInfo);

    if (extraAccountMetasInfo === null) {
      const initializeExtraAccountMetaListInstruction = await program.methods
      .initializeExtraAccountMetaList()
      .accounts({
        mint: mint.publicKey,
        extraAccountMetaList: extraAccountMetaListPDA,
        counterAccount: counterPDA,
      })
      .instruction();

      const transaction = new Transaction().add(
        initializeExtraAccountMetaListInstruction
      );

      const txSig = await sendAndConfirmTransaction(
        provider.connection,
        transaction,
        [wallet.payer],
        { skipPreflight: true, commitment: "confirmed"}
      );
      console.log("Transaction Signature:", txSig);
    }

  });

  it("Transfer Hook with Extra Account Meta", async () => {
    // 2 tokens
    const amount = 2 * 10 ** decimals;
    const amountBigInt = BigInt(amount);

    const preCounterState = await program.account.counterAccount.fetch(counterPDA, "confirmed");
    const preSourceBalance = await connection.getTokenAccountBalance(sourceTokenAccount, "confirmed");
    const preDestinationBalance = await connection.getTokenAccountBalance(destinationTokenAccount, "confirmed");
    
    let transferInstructionWithHelper = await createTransferCheckedWithTransferHookInstruction( 
      connection,
      sourceTokenAccount,
      mint.publicKey,
      destinationTokenAccount,
      wallet.publicKey,
      amountBigInt,
      decimals,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );

    console.log("Extra accounts meta: " + extraAccountMetaListPDA);
    console.log("Counter PDa: " + counterPDA);
    console.log("Transfer Instruction: " + JSON.stringify(transferInstructionWithHelper));
    
    const transaction1 = new Transaction().add(
      transferInstructionWithHelper
    );

    const txSig1 = await sendAndConfirmTransaction(
      connection,
      transaction1,
      [wallet.payer],
      { skipPreflight: true, commitment: "confirmed" }
    );
    console.log("Transfer Signature 1:", txSig1);

    const post1CounterState = await program.account.counterAccount.fetch(counterPDA, "confirmed");
    const post1SourceBalance = await connection.getTokenAccountBalance(sourceTokenAccount, "confirmed");
    const post1DestinationBalance = await connection.getTokenAccountBalance(destinationTokenAccount, "confirmed");

    const sleep = (milliseconds: number) => { return new Promise(resolve => setTimeout(resolve, milliseconds)); };
    await sleep(5000);

    const transaction2 = new Transaction().add(
      transferInstructionWithHelper
    );

    const txSig2 = await sendAndConfirmTransaction(
      connection,
      transaction2,
      [wallet.payer],
      { skipPreflight: true, commitment: "confirmed" }
    );
    console.log("Transfer Signature 2:", txSig2);

    const post2CounterState = await program.account.counterAccount.fetch(counterPDA, "confirmed");
    const post2SourceBalance = await connection.getTokenAccountBalance(sourceTokenAccount, "confirmed");
    const post2DestinationBalance = await connection.getTokenAccountBalance(destinationTokenAccount, "confirmed");

    console.log("Counter value: "
      + preCounterState.counter + " -> "
      + post1CounterState.counter + " -> "
      + post2CounterState.counter);
    console.log("Soruce balance: "
      + preSourceBalance.value.uiAmountString + " -> " 
      + post1SourceBalance.value.uiAmountString + " -> "
      + post2SourceBalance.value.uiAmountString);
    console.log("Destination balance: "
      + preDestinationBalance.value.uiAmountString + " -> "
      + post1DestinationBalance.value.uiAmountString + " -> "
      + post2DestinationBalance.value.uiAmountString);    
  });

  it("Fail: AmountTooBig", async () => {
    // 1001 tokens (> 1000)
    const amount = 1001 * 10 ** decimals;
    const amountBigInt = BigInt(amount);

    let transferInstructionWithHelper = await createTransferCheckedWithTransferHookInstruction( 
      connection,
      sourceTokenAccount,
      mint.publicKey,
      destinationTokenAccount,
      wallet.publicKey,
      amountBigInt,
      decimals,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );
    
    const transaction = new Transaction().add(
      transferInstructionWithHelper
    );

    try {
      const txSig = await sendAndConfirmTransaction(
        connection,
        transaction,
        [wallet.payer],
        { skipPreflight: true, commitment: "confirmed" }
      );
    } catch (e) {
      const msg = e.toString();
      console.log("Transaction failed:", msg);
    }
  });
});
