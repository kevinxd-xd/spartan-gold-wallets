"use strict";

let EventEmitter = require('events');

let Blockchain = require('./blockchain.js');

let utils = require('./utils.js');

const { mnemonicToSeedSync } = require('bip39');
const { pki, random } = require('node-forge');

/**
 * A client has a public/private keypair and an address.
 * It can send and receive messages on the Blockchain network.
 * 
 * Credit: UVNishanth from Github and the SparanGold repo for giving us a starting point with determinisitic address generation.
 */
module.exports = class Client extends EventEmitter {

  /**
   * The net object determines how the client communicates
   * with other entities in the system. (This approach allows us to
   * simplify our testing setup.)
   * 
   * ADDITIONAL IMPLEMENTATION: Takes the mnemonic and creates a PRNG instance that always reproduces the same sequence of data, allowing us
   * to deterministically generate keypairs
   * 
   * @constructor
   * @param {Object} obj - The properties of the client.
   * @param {String} [obj.name] - The client's name, used for debugging messages.
   * @param {String} [obj.password] - The client's password, used for generating address.
   * @param {Object} obj.net - The network used by the client
   *    to send messages to all miners and clients.
   * @param {Block} [obj.startingBlock] - The starting point of the blockchain for the client.
   * @param {Object} [obj.keyPair] - The public private keypair for the client.
   * @param {String} [obj.mnemonic] - the mnemonic that the user would like to use for their wallet
   */
  constructor({name, password, net, startingBlock, mnemonic} = {}) {
    super();

    this.net = net;
    this.name = name;

    this.password = password ? password : this.name+"_pswd";
    this.mnemonic = mnemonic;
    this.wallet = [];

    // If the blockchain exists
    if (Blockchain.hasInstance()){
      if (this.mnemonic === undefined){
        throw new Error(`mnemonic not set`);
      }
       // Create seed
       this.seed = mnemonicToSeedSync(this.mnemonic, this.password).toString('hex');
       this.prng = random.createInstance();
       // Set seed
       this.prng.seedFileSync = () => this.seed;
       // Generate initial/starting address
       this.generateAddress();
    }

    // Establishes order of transactions.  Incremented with each
    // new output transaction from this client.  This feature
    // avoids replay attacks.
    this.nonce = 0;

    // A map of transactions where the client has spent money,
    // but where the transaction has not yet been confirmed.
    this.pendingOutgoingTransactions = new Map();

    // A map of transactions received but not yet confirmed.
    this.pendingReceivedTransactions = new Map();

    // A map of all block hashes to the accepted blocks.
    this.blocks = new Map();

    // A map of missing block IDS to the list of blocks depending
    // on the missing blocks.
    this.pendingBlocks = new Map();

    if (startingBlock) {
      this.setGenesisBlock(startingBlock);
    }

    // Setting up listeners to receive messages from other clients.
    this.on(Blockchain.PROOF_FOUND, this.receiveBlock);
    this.on(Blockchain.MISSING_BLOCK, this.provideMissingBlock);
  }

  /**
   * The genesis block can only be set if the client does not already
   * have the genesis block.
   * 
   * @param {Block} startingBlock - The genesis block of the blockchain.
   */
  setGenesisBlock(startingBlock) {
    if (this.lastBlock) {
      throw new Error("Cannot set genesis block for existing blockchain.");
    }

    // Transactions from this block or older are assumed to be confirmed,
    // and therefore are spendable by the client. The transactions could
    // roll back, but it is unlikely.
    this.lastConfirmedBlock = startingBlock;

    // The last block seen.  Any transactions after lastConfirmedBlock
    // up to lastBlock are considered pending.
    this.lastBlock = startingBlock;

    this.blocks.set(startingBlock.id, startingBlock);
  }

  /**
   * The amount of gold available to the client, not counting any pending
   * transactions.  This getter looks at the last confirmed block, since
   * transactions in newer blocks may roll back.
   */

  // This one will likely need to be re-implemented
  get confirmedBalance() {

    let balance = 0;

    this.wallet.forEach(({ address }) => {
      balance += this.lastConfirmedBlock.balanceOf(address);
    })

    return balance;
  }

  /**
   * Any gold received in the last confirmed block or before is considered
   * spendable, but any gold received more recently is not yet available.
   * However, any gold given by the client to other clients in unconfirmed
   * transactions is treated as unavailable.
   */
  get availableGold() {
    let pendingSpent = 0;
    this.pendingOutgoingTransactions.forEach((tx) => {
      pendingSpent += tx.totalOutput();
    });

    return this.confirmedBalance - pendingSpent;
  }

  /**
   * Broadcasts a transaction from the client giving gold to the clients
   * specified in 'outputs'. A transaction fee may be specified, which can
   * be more or less than the default value.
   * 
   * ADDTIONAL IMPLEMENTATION: UTXO-based, ignores the postGeneric function as implemented from HW2 (Kevin Chau)
   * 
   * @param {Array} outputs - The list of outputs of other addresses and
   *    amounts to pay.
   * @param {number} [fee] - The transaction fee reward to pay the miner.
   * 
   * @returns {Transaction} - The posted transaction.
   */
  postTransaction(outputs, fee=Blockchain.DEFAULT_TX_FEE) {
    // We calculate the total value of gold needed.
    let total = 0;
    outputs.forEach(({amount, address}) => {
        total += amount;
    });
    total += fee;

    if (total > this.getConfirmedBalance()) {
        throw new Error("Not enough money!");
    }

    // Gather UTXOs
    let gathered = 0;
    // let walletPos = 0;
    let gatheredPriv = [];
    let gatheredAddrs = [];
    let gatheredKeys = [];

    while (total > gathered) {
        // Takes and removes the oldest UTXO from the array first
        let nextKey = this.wallet.shift();
        gathered += this.lastConfirmedBlock.balanceOf(nextKey["address"]);
        gatheredAddrs.push(nextKey["address"]);
        gatheredKeys.push(nextKey["keyPair"].public);
        gatheredPriv.push(nextKey["keyPair"].private);
    }

    // If how much we gathered is more than total, we need to create a change address
    if (gathered > total) {
      let change = gathered - total;
      console.log();
      console.log(`***Need to make ${change} change, with ${gathered} in and ${total} out.`);
      console.log();
      let newAddr = this.generateAddress();
      outputs.push({amount: change, address: newAddr});
    }

    // Make the transaction
    let tx = Blockchain.makeTransaction(Object.assign({
      from: gatheredAddrs,
      nonce: 0,
      pubKey: gatheredKeys},
      {outputs: outputs, fee: fee}));

    // Sign the transaction with all private keys
    gatheredPriv.forEach((pk) => {
        tx.sign(pk);
    });
    // Adding transaction to pending.
    this.pendingOutgoingTransactions.set(tx.id, tx);

    this.net.broadcast(Blockchain.POST_TRANSACTION, tx);

    // If the client is a miner, add the transaction to the current block.
    if (this.addTransaction !== undefined) {
        this.addTransaction(tx);
    }

    return tx;
  }

  /**
   * Broadcasts a transaction from the client.  No validation is performed,
   * so the transaction might be rejected by other miners.
   * 
   * This method is useful for handling special transactions with unique
   * parameters required, but generally should not be called directly by clients.
   * 
   * @param {Object} txData - The key-value pairs of the transaction.
   * 
   * @returns {Transaction} - The posted transaction.
   */
  postGenericTransaction(txData) {
    // Creating a transaction, with defaults for the
    // from, nonce, and pubKey fields.
    let tx = Blockchain.makeTransaction(
      Object.assign({
          from: this.address,
          nonce: this.nonce,
          pubKey: this.keyPair.public,
        },
        txData));

    tx.sign(this.keyPair.private);

    // Adding transaction to pending.
    this.pendingOutgoingTransactions.set(tx.id, tx);

    this.nonce++;

    this.net.broadcast(Blockchain.POST_TRANSACTION, tx);

    return tx;
  }

  /**
   * Validates and adds a block to the list of blocks, possibly updating the head
   * of the blockchain.  Any transactions in the block are rerun in order to
   * update the gold balances for all clients.  If any transactions are found to be
   * invalid due to lack of funds, the block is rejected and 'null' is returned to
   * indicate failure.
   * 
   * If any blocks cannot be connected to an existing block but seem otherwise valid,
   * they are added to a list of pending blocks and a request is sent out to get the
   * missing blocks from other clients.
   * 
   * @param {Block | Object} block - The block to add to the clients list of available blocks.
   * 
   * @returns {Block | null} The block with rerun transactions, or null for an invalid block.
   */
  receiveBlock(block) {
    // If the block is a string, then deserialize it.
    block = Blockchain.deserializeBlock(block);

    // Ignore the block if it has been received previously.
    if (this.blocks.has(block.id)) return null;

    // First, make sure that the block has a valid proof. 
    if (!block.hasValidProof() && !block.isGenesisBlock()) {
      this.log(`Block ${block.id} does not have a valid proof.`);
      return null;
    }

    // Make sure that we have the previous blocks, unless it is the genesis block.
    // If we don't have the previous blocks, request the missing blocks and exit.
    let prevBlock = this.blocks.get(block.prevBlockHash);
    if (!prevBlock && !block.isGenesisBlock()) {
      let stuckBlocks = this.pendingBlocks.get(block.prevBlockHash);

      // If this is the first time that we have identified this block as missing,
      // send out a request for the block.
      if (stuckBlocks === undefined) { 
        this.requestMissingBlock(block);
        stuckBlocks = new Set();
      }
      stuckBlocks.add(block);

      this.pendingBlocks.set(block.prevBlockHash, stuckBlocks);
      return null;
    }

    if (!block.isGenesisBlock()) {
      // Verify the block, and store it if everything looks good.
      // This code will trigger an exception if there are any invalid transactions.
      let success = block.rerun(prevBlock);
      if (!success) return null;
    }

    // Storing the block.
    this.blocks.set(block.id, block);

    // If it is a better block than the client currently has, set that
    // as the new currentBlock, and update the lastConfirmedBlock.
    if (this.lastBlock.chainLength < block.chainLength) {
      this.lastBlock = block;
      this.setLastConfirmed();
    }

    // Go through any blocks that were waiting for this block
    // and recursively call receiveBlock.
    let unstuckBlocks = this.pendingBlocks.get(block.id) || [];
    // Remove these blocks from the pending set.
    this.pendingBlocks.delete(block.id);
    unstuckBlocks.forEach((b) => {
      this.log(`Processing unstuck block ${b.id}`);
      this.receiveBlock(b);
    });

    return block;
  }

  /**
   * Request the previous block from the network.
   * 
   * @param {Block} block - The block that is connected to a missing block.
   */
  requestMissingBlock(block) {
    this.log(`Asking for missing block: ${block.prevBlockHash}`);
    let msg = {
      from: this.address,
      missing: block.prevBlockHash,
    };
    this.net.broadcast(Blockchain.MISSING_BLOCK, msg);
  }

  /**
   * Resend any transactions in the pending list.
   */
  resendPendingTransactions() {
    this.pendingOutgoingTransactions.forEach((tx) => {
      this.net.broadcast(Blockchain.POST_TRANSACTION, tx);
    });
  }

  /**
   * Takes an object representing a request for a missing block.
   * If the client has the block, it will send the block to the
   * client that requested it.
   * 
   * @param {Object} msg - Request for a missing block.
   * @param {String} msg.missing - ID of the missing block.
   */
  provideMissingBlock(msg) {
    if (this.blocks.has(msg.missing)) {
      this.log(`Providing missing block ${msg.missing}`);
      let block = this.blocks.get(msg.missing);
      this.net.sendMessage(msg.from, Blockchain.PROOF_FOUND, block);
    }
  }

  /**
   * Sets the last confirmed block according to the most recently accepted block,
   * also updating pending transactions according to this block.
   * Note that the genesis block is always considered to be confirmed.
   */
  setLastConfirmed() {
    let block = this.lastBlock;
    let confirmedBlockHeight = block.chainLength - Blockchain.CONFIRMED_DEPTH;
    if (confirmedBlockHeight < 0) {
      confirmedBlockHeight = 0;
    }
    while (block.chainLength > confirmedBlockHeight) {
      block = this.blocks.get(block.prevBlockHash);
    }
    this.lastConfirmedBlock = block;

    // Update pending transactions according to the new last confirmed block.
    this.pendingOutgoingTransactions.forEach((tx, txID) => {
      if (this.lastConfirmedBlock.contains(tx)) {
        this.pendingOutgoingTransactions.delete(txID);
      }
    });
  }

  /**
   * Utility method that displays all confirmed balances for all clients,
   * according to the client's own perspective of the network.
   */
  showAllBalances() {
    let bc = Blockchain.getInstance();
    this.log("Showing balances:");
    for (let [id,balance] of this.lastConfirmedBlock.balances) {
      let name = bc.getClientName(id);
      if (name) {
        console.log(`    ${id} (${name}): ${balance}`);
      } else {
        console.log(`    ${id}: ${balance}`);
      }
    }
  }
 
  /**
   * Logs messages to stdout, including the name to make debugging easier.
   * If the client does not have a name, then one is calculated from the
   * client's address.
   * 
   * @param {String} msg - The message to display to the console.
   */
  log(msg) {
    let name = this.name || this.address.substring(0,10);
    console.log(`${name}: ${msg}`);
  }

  /**
   * ADDITIONAL IMPLEMENTATION:
   * 
   * Print out the blocks in the blockchain from the current head
   * to the genesis block.  Only the Block IDs are printed.
   */
  showBlockchain() {
    let block = this.lastBlock;
    console.log("BLOCKCHAIN:");
    while (block !== undefined) {
      console.log(block.id);
      block = this.blocks.get(block.prevBlockHash);
    }
  }

  /**
   * ADDITIONAL IMPLEMENTATION:
   * 
   * Generate client address using mnemonic set by client or config file. After generating it, adds it to client's wallet
   */
  generateAddress(){
    this.keyPair = this.generateKeypairFromMnemonic();
    this.address = utils.calcAddress(this.keyPair.public);
    this.wallet.push({ address: this.address, keyPair: this.keyPair});

    return this.address;
  }

  /**
   * ADDITIONAL IMPLEMENTATION:
   * 
   * Creates the wallet for the user when first instantiated. Creates an intial starting address and adds it to the wallet
   */
  createWallet() {
    this.wallet = [];
    this.wallet.push({ address: this.address, keyPair: this.keyPair});
  }

  /**
   * ADDITIONAL IMPLEMENTATION:
   * 
   * Finds and prints a table of all the UTXOs in the block.
   */
  showAllUTXOs() {
    let table= [];
    this.wallet.forEach(({ address }) => {
      let amount = this.lastConfirmedBlock.balanceOf(address);
      table.push({ address: address, amount: amount });
    });
    table.push({ address: "***TOTAL***", amount: this.confirmedBalance });
    console.table(table);
  }

  /**
   * ADDITIONAL IMPLEMENTATION:
   * 
   * Generates keypairs deterministically use the prng (Psuedo-random-number generator) library. By default use the prng instance created from instantiation
   * @param {*} prng - instance of PRNG, basicall the seed
   * @returns {object} - returns public and private key
   */
  generateKeypairFromMnemonic(prng=this.prng) {
    const { privateKey, publicKey } = pki.rsa.generateKeyPair({ bits: 512, prng: prng, workers: 2 });
    return {
        public: pki.publicKeyToPem(publicKey),
        private: pki.privateKeyToPem(privateKey),
    };
  }

  /**
   * ADDITIONAL IMPLEMENTATION:
   * 
   * Iterates through the client's wallet and sums up how much they have
   * @returns the balance of the user according to their wallet
   */
  getConfirmedBalance() {
    let totalAmount = 0;
    this.wallet.forEach(({ address }) => {
        totalAmount += this.lastConfirmedBlock.balanceOf(address);
    });
    return totalAmount;
  }

  /**
   * ADDITIONAL IMPLEMENTATION:
   * 
   * Generates the next key and checks if there are funds, does it until it doesn't detect any more funds plus the no. of attempts. Ex. keys with money + 5 more
   * @param {int} maxAttempts check how many more attempts until it stops. default 5
   */
  recoverFunds(maxAttempts=5) {
    let attempts = 0;
    let genKeyPair;
    let checkAddress;
    // While there still is money in the addresses we are checking or we haven't exceeded our max number of attempts
    while(this.lastConfirmedBlock.balanceOf(checkAddress) !== 0 || attempts < maxAttempts) {
      // Generates key/address
      genKeyPair = this.generateKeypairFromMnemonic();
      checkAddress = utils.calcAddress(genKeyPair.public);
      console.log(`Checking for funds at address: ${checkAddress}`);
      // Is there money in that address? If not, move on, else we add it to the wallet and reset our attempts.
      if (this.lastConfirmedBlock.balanceOf(checkAddress) === 0) {
        attempts += 1;
        console.log(`No funds were found at address: ${checkAddress}`);
      }
      // Reset attempts if it finds money
      else {
        attempts = 0;
        this.wallet.push({ address: checkAddress, keyPair: genKeyPair});
        console.log(`Successfully recovered ${this.lastConfirmedBlock.balanceOf(checkAddress)} at address ${checkAddress}!`);
      }
    }
  }
};
