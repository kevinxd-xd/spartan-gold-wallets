"use strict";

let crypto = require('crypto');
//Added Bip39 for mnemonic
//let bip39 = require('bip39');

const { mnemonicToSeedSync } = require('bip39');
const { pki, random } = require('node-forge');

//added for mnemonic
//const NUM_BYTES = 32;
const Mnemonic = require('./mnemonic.js').Mnemonic;

// CRYPTO settings
const HASH_ALG = 'sha256';
const SIG_ALG = 'RSA-SHA256';

exports.hash = function hash(s, encoding) {
  encoding = encoding || 'hex';
  return crypto.createHash(HASH_ALG).update(s).digest(encoding);
};

/**
 * Generates keypair from mnemonic and password
 * 
 * @param {String} mnemonic - associated with the blockchain instance
 * @param {String} password - unique to each user
 * @returns 
 */
//https://stackoverflow.com/questions/72047474/how-to-generate-safe-rsa-keys-deterministically-using-a-seed
exports.generateKeypairFromMnemonic = function( mnemonic, password ) {
  const seed = mnemonicToSeedSync(mnemonic, password).toString('hex');
  const prng = random.createInstance();
  prng.seedFileSync = () => seed;
  const { privateKey, publicKey } = pki.rsa.generateKeyPair({ bits: 512, prng, workers: 2 });
  return {
      public: pki.publicKeyToPem(publicKey),
      private: pki.privateKeyToPem(privateKey),
  };
};


exports.generateKeypair = function() {
  const kp = crypto.generateKeyPairSync('rsa', {
    modulusLength: 512,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
  });
  return {
    public: kp.publicKey,
    private: kp.privateKey,
  };
};

exports.sign = function(privKey, msg) {
  let signer = crypto.createSign(SIG_ALG);
  // Convert an object to its JSON representation
  let str = (msg === Object(msg)) ? JSON.stringify(msg) : ""+msg;
  return signer.update(str).sign(privKey, 'hex');
};

exports.verifySignature = function(pubKey, msg, sig) {
  let verifier = crypto.createVerify(SIG_ALG);
  // Convert an object to its JSON representation
  let str = (msg === Object(msg)) ? JSON.stringify(msg) : ""+msg;
  return verifier.update(str).verify(pubKey, sig, 'hex');
};

exports.calcAddress = function(key) {
  let addr = exports.hash(""+key, 'base64');
  //console.log(`Generating address ${addr} from ${key}`);
  return addr;
};

exports.addressMatchesKey = function(addr, pubKey) {
  return addr === exports.calcAddress(pubKey);
};

exports.generateMnemonic = function(){
	let mnemonic = new Mnemonic();
	console.log(mnemonic.words());
	return mnemonic.words(); 
};

exports.checkAddresses = function(minerMap,blockMap){
	let temp = {};
	for(let i in minerMap){
		if(blockMap.get(i) !== undefined){
			temp[i] = blockMap.get(i);
		}
	}
	return temp;
	
};