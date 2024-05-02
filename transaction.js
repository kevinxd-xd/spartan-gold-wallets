"use strict";

const utils = require('./utils.js');

// String constants mixed in before hashing.
const TX_CONST = "TX";

/**
 * A transaction comes from a single account, specified by "address". For
 * each account, transactions have an order established by the nonce. A
 * transaction should not be accepted if the nonce has already been used.
 * (Nonces are in increasing order, so it is easy to determine when a nonce
 * has been used.)
 */
module.exports = class Transaction {

  /**
   * The constructor for a transaction includes an array of outputs, meaning
   * that one transaction can pay multiple parties. An output is a pair of an
   * amount of gold and the hash of a public key (also called the address),
   * in the form:
   *    {amount, address}
   * 
   * @constructor
   * @param {Object} obj - The inputs and outputs of the transaction.
   * @param obj.from - The address of the payer.
   * @param obj.nonce - Number that orders the payer's transactions.  For coinbase
   *          transactions, this should be the block height.
   * @param obj.pubKey - Public key associated with the specified from address.
   * @param obj.sig - Signature of the transaction.  This field may be omitted.
   * @param {Array} [obj.outputs] - An array of the outputs.
   * @param [obj.fee] - The amount of gold offered as a transaction fee.
   * @param [obj.data] - Object with any additional properties desired for the transaction.
   */
  constructor({from, nonce, pubKey, sig=[], outputs, fee=0, data={}}) {
    this.from = from;
    this.nonce = nonce;
    this.pubKey = pubKey;
    this.sig = sig;
    this.fee = fee;
    this.outputs = [];
    if (outputs) outputs.forEach(({amount, address}) => {
      if (typeof amount !== 'number') {
        amount = parseInt(amount, 10);
      }
      this.outputs.push({amount, address});
    });
    this.data = data;
  }

  /**
   * A transaction's ID is derived from its contents.
   */
  get id() {
    return utils.hash(TX_CONST + JSON.stringify({
      from: this.from,
      nonce: this.nonce,
      pubKey: this.pubKey,
      outputs: this.outputs,
      fee: this.fee,
      data: this.data }));
  }

  /**
   * Signs a transaction and stores the signature in the transaction.
   * 
   * @param privKey  - The key used to sign the signature.  It should match the
   *    public key included in the transaction.
   */
  sign(privKey) {
    this.sig.push(utils.sign(privKey, this.id));
  }

  /**
   * Determines whether the signature of the transaction is valid
   * and if the from address matches the public key.
   * 
   * @returns {Boolean} - Validity of the signature and from address.
   */
  validSignature() {
    for (let i = 0; i < this.from.length; i++) {
      if (!utils.addressMatchesKey(this.from[i], this.pubKey[i])) {
          console.log("Address and keys do not match!");
          return false;
      }
      if (this.sig[i] === undefined) {
          console.log("No signature found!");
          return false;
      }
      if (!utils.verifySignature(this.pubKey[i], this.id, this.sig[i])) {
          console.log("Signature not valid for the ID!");
          return false;
      }

      return true;
    }
  }

  /**
   * Verifies that there is currently sufficient gold for the transaction.
   * 
   * @param {Block} block - Block used to check current balances
   * 
   * @returns {boolean} - True if there are sufficient funds for the transaction,
   *    according to the balances from the specified block.
   */
  sufficientFunds(block) {
    return this.totalOutput() <= this.totalInput(block);
  }

  /**
   * Calculates the total value of all outputs, including the transaction fee.
   * 
   * @returns {Number} - Total amount of gold given out with this transaction.
   */
  totalOutput() {
    return this.outputs.reduce( (totalValue, {amount}) => totalValue + amount, this.fee);
  }

  /**
   * Returns how much unspent outputs are being transferred in this transaction
   * 
   * ADDITIONAL IMPLEMENTATION: Added UTXO model feature from HW2 (Kevin Chau)
   * @param {*} block block to use for checking balances of addresses
   * @returns the total amount of output for this transaction
   */
  totalInput(block) {
    // Look up the balance for all address in the 'from' field of 'this'.
    let sum = 0
    this.from.forEach(pk => {
       sum += block.balanceOf(pk) 
    });

    return sum;
}
};
