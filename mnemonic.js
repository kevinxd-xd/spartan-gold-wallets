"use strict";

//const fs = require('fs');
const crypto = require('crypto');
const bip39 = require('bip39');


const HASH_ALG = 'sha256';
const NUM_BYTES = 32;

const SALT_BASE = "mnemonic";
const NUM_PBKDF2_ROUNDS = 2048;
const KEY_LENGTH = 64; // 64 bytes = 512 bits
const PBKDF2_DIGEST = 'sha512'; // Should be 'hmac-sha512'

class Mnemonic {

  // Converts a byte to a string of zeroes and ones.
  static convertByteToBinString(byte) {
    let bs = "";
    // Test each bit individually, appending either a 1 or a 0.
    bs += byte & 0x80 ? "1" : "0";
    bs += byte & 0x40 ? "1" : "0";
    bs += byte & 0x20 ? "1" : "0";
    bs += byte & 0x10 ? "1" : "0";
    bs += byte & 0x08 ? "1" : "0";
    bs += byte & 0x04 ? "1" : "0";
    bs += byte & 0x02 ? "1" : "0";
    bs += byte & 0x01 ? "1" : "0";
    return bs;
  }

  // Converts a string of zeroes and ones to a byte
  static convertBinStringToByte(bs) {
   
	return parseInt(bs,2);
	
  }

  // Takes a buffer and returns an array of 11-bit unsigned ints
  static split(seq) {
    // convert seq to binary string
    let bitString = '';
    for (let byte of seq.values()) {
      let bs = this.convertByteToBinString(byte);
      bitString += bs;
    }

    // break up binary into 11bits
    let elevenBits = bitString.match(/.{11}/g);

    // convert 11bits to ints
    return elevenBits.map(bs => {
      let bitPosVal = 1024;
      let val = 0;
      for (let i=0; i<bs.length; i++) {
        let bit = bs.charAt(i);
        if (bit === "1") val += bitPosVal;
        bitPosVal = bitPosVal / 2;
      }
      return val;
    });
  }

  // Converts an 11-bit number to a string of 0's and 1's.
  static translate11bit(n) {
    let bitPosVal = 1024;
    let bs = "";
    while (bitPosVal >= 1) {
      if (n >= bitPosVal) {
        bs += "1";
        n -= bitPosVal;
      } else {
        bs += "0";
      }
      bitPosVal = bitPosVal / 2;
    }
    return bs;
  }


  // Loads a wordlist file and creates a random sequence
  // to generate the mnemonic words.
  constructor() {
    
    this.wordlist = bip39.wordlists.english;

    // New mnemonic.
    
     // Creating the sequence, with an extra byte for the checksum.
    this.seq = Buffer.alloc(NUM_BYTES + 1);

	  crypto.randomFillSync(this.seq); 
	  
	  this.seq.writeUInt8(this.calcChecksum(), NUM_BYTES);
	
	 
     

  }

  // Returns a string with the sequence of words matching to
  // the random sequence.
  words() {
    // Returns an array of 11-bit numbers.
    let arr = this.constructor.split(this.seq);

  
	let stringBuilder = "";
	for(let i in arr){
	
		stringBuilder += " " + this.wordlist[arr[i]];
	}
	stringBuilder = stringBuilder.substring(1);
	return stringBuilder;
	
  }

  // Hash the sequence, returning the first byte.
  calcChecksum() {
    // Dropping the last byte, holding the checksum.
    let seqHex = this.seq.toString('hex').slice(0, NUM_BYTES);
    let buf = Buffer.from(seqHex);

    // Hashing the buffer, returning the first byte of the hash
    // as the checksum.
    let h = crypto.createHash(HASH_ALG).update(buf).digest();
    return h[0];
  }

  calculateSequence(words) {
    let wordArray = words.split(' ');
    // Extra byte for checksum
    this.seq = Buffer.alloc(NUM_BYTES + 1);

	let binString = "";
	for(let i in wordArray){
		
		for(let j in this.wordlist){
			
			if(wordArray[i] === this.wordlist[j]){
				binString += "" + this.constructor.translate11bit(j);
				
			}				
			
		}

		
		
	}
	
	
	let position = 0;
	while(position !== NUM_BYTES+ 1){
		let temp = this.constructor.convertBinStringToByte(binString.substring(0,8));
		this.seq.writeUInt8(temp,position);
		position++;
		binString = binString.substring(8);
		
	}
	
  }
 
  // Returns true if the checksum matches its contents.
  isValid() {
    let checksum = this.calcChecksum();
    return checksum === this.seq.readUInt8(NUM_BYTES);
  }

  // Returns a random seed derived from the mnemonic and an optional passphrase.
  generateSeed(passphrase="") {
    let key = crypto.pbkdf2Sync(this.seq, SALT_BASE + passphrase, NUM_PBKDF2_ROUNDS, KEY_LENGTH, PBKDF2_DIGEST);
    return key.toString('hex');
  }
}

exports.Mnemonic = Mnemonic;

