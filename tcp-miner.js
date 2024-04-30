const net = require('net');
const readline = require('readline');
const { readFileSync, writeFileSync } = require('fs');

const FakeNet = require('./fake-net.js');
const Blockchain = require('./blockchain.js');
const Block = require('./block.js');
const Miner = require('./miner.js');
const Transaction = require('./transaction.js');
const utils = require('./utils.js');

/**
 * This extends the FakeNet class to actually communicate over the network.
 */
class TcpNet extends FakeNet {
  sendMessage(address, msg, o) {
    if (typeof o === 'string') o = JSON.parse(o);
    let data = {msg, o};
    const client = this.clients.get(address);
    let clientConnection = net.connect(client.connection, () => {
      clientConnection.write(JSON.stringify(data));
    });
  }
}

/**
 * Provides a command line interface for a SpartanGold miner
 * that will actually communicate over the network.
 */
class TcpMiner extends Miner {
  static get REGISTER() { return "REGISTER"; }

  /**
   * In addition to the usual properties for a miner, the constructor
   * also takes a JSON object for the connection information and sets
   * up a listener to listen for incoming connections.
   */
  constructor({name, startingBlock, miningRounds, keyPair, connection, mnemonic} = {}) {
    super({name, net: new TcpNet(), startingBlock, keyPair, miningRounds, mnemonic});

    // Setting up the server to listen for connections
    this.connection = connection;
    this.srvr = net.createServer();
    this.srvr.on('connection', (client) => {
      this.log('Received connection');
      client.on('data', (data) => {
        let {msg, o} = JSON.parse(data);
        if (msg === TcpMiner.REGISTER) {
          if (!this.net.recognizes(o)) {
            this.registerWith(o.connection);
          }
          this.log(`Registering ${JSON.stringify(o)}`);
          this.net.register(o);
        } else {
          this.emit(msg, o);
        }
      });
    });
  }

  /**
   * Connects with the miner specified using the connection details provided.
   * 
   * @param {Object} minerConnection - The connection information for the other miner.
   */
  registerWith(minerConnection) {
    this.log(`Connection: ${JSON.stringify(minerConnection)}`);
    let conn = net.connect(minerConnection, () => {
      let data = {
        msg: TcpMiner.REGISTER,
        o: {
          name: this.name,
          address: this.address,
          connection: this.connection,
        }
      };
      conn.write(JSON.stringify(data));
    });
  }

  /**
   * Begins mining and registers with any known miners.
   */
  initialize(knownMinerConnections) {
    this.knownMiners = knownMinerConnections;
    super.initialize();
    this.srvr.listen(this.connection.port);
    for (let m of knownMinerConnections) {
      this.registerWith(m);
    }
  }

  /**
   * Prints out a list of any pending outgoing transactions.
   */
  showPendingOut() {
    let s = "";
    this.pendingOutgoingTransactions.forEach((tx) => {
      s += `\n    id:${tx.id} nonce:${tx.nonce} totalOutput: ${tx.totalOutput()}\n`;
    });
    return s;
  }

  saveJson(fileName) {
    let state = {
      name: this.name,
      connection: this.connection,
      keyPair: this.keyPair,
      knownMiners: this.knownMiners,
	  //added
	  mnemonic: config.mnemonic,
    };
    writeFileSync("sampleConfigs/"+fileName, JSON.stringify(state));
  }

}

if (process.argv.length !== 3) {
  console.error(`Usage: ${process.argv[0]} ${process.argv[1]} <config.json>`);
  process.exit();
}
let config = JSON.parse(readFileSync(process.argv[2]));
let name = config.name;

let knownMiners = config.knownMiners || [];

// Clearing the screen so things look a little nicer.
console.clear();


// Need to adjust here
// let startingBalances = config.genesis ? config.genesis.startingBalances : {};
// We need to create a proper set up
let blockchainInstance = Blockchain.createInstance({
  blockClass: Block,
  transactionClass: Transaction,
  startingBalances: config.startingBalances
});

console.log(`Starting ${name}`);
//generates mnemonic for config if no config is found

//console.log(config.mnemonic);
let generatedMnemonic = false;
if(config.mnemonic == undefined || config.mnemonic == ""){
	config.mnemonic = utils.generateMnemonic();
	generatedMnemonic = true;
	
}

//checks config mnemonic
//console.log(config.mnemonic);

let minnie = new TcpMiner({name: name, keyPair: config.keyPair, connection: config.connection, startingBlock: blockchainInstance.genesis, mnemonic: config.mnemonic});

// Silencing the logging messages
minnie.log = function(){};

// Register with known miners and begin mining.
minnie.initialize(knownMiners);

//saves the Json if mnemonic is generated
//basically autosave
if(generatedMnemonic){
	let argvSplit = process.argv[2].split("/");
	minnie.saveJson(argvSplit[argvSplit.length-1]);
}
console.log(minnie);

let rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let address = minnie.address;

function readUserInput() {
  rl.question(`
  Funds: ${minnie.availableGold}
  Address: ${address}
  Pending transactions: ${minnie.showPendingOut()}
  
  What would you like to do?
  *(c)onnect to miner?
  *(t)ransfer funds?
  *genereate new (a)ddress
  *(r)esend pending transactions?
  *show (b)alances?
  *show blocks for (d)ebugging and exit?
  *show all UTXO balances
  *(f)und recovery
  *(s)ave your state?
  *e(x)it without saving?
  
  Your choice: `, (answer) => {
    console.clear();
    switch (answer.trim().toLowerCase()) {
      case 'x':
        console.log(`Shutting down.  Have a nice day.`);
        process.exit(0);
        /* falls through */
      case 'b':
        console.log("  Balances: ");
        minnie.showAllBalances();
        break;
      case 'c':
        rl.question(`  port: `, (p) => {
          minnie.registerWith({port: p});
          console.log(`Registering with miner at port ${p}`);
          readUserInput();
        });
        break;
      case 't':
        rl.question(`  amount: `, (amt) => {
          amt = parseInt(amt, 10);
          if (amt > minnie.availableGold) {
            console.log(`***Insufficient gold.  You only have ${minnie.availableGold}.`);
            readUserInput();
          } else {
            rl.question(`  address: `, (addr) => {
              let output = {amount: amt, address: addr};
              console.log(`Transferring ${amt} gold to ${addr}.`);
              minnie.postTransaction([output]);
              readUserInput();
            });
          }
        });
        break;
      case 'r':
        minnie.resendPendingTransactions();
        break;
      case 's':
        rl.question(`  file name: `, (fname) => {
          minnie.saveJson(fname);
          readUserInput();
        });
        break;
      case 'd':
        minnie.blocks.forEach((block) => {
          let s = "";
          block.transactions.forEach((tx) => s += `${tx.id} `);
          if (s !== "") console.log(`${block.id} transactions: ${s}`);
        });
        console.log();
        minnie.showBlockchain();
        process.exit(0);
        /* falls through */
      case 'a':
        address = minnie.generateAddress();
        readUserInput();
        break;
      case 'u':
        console.clear();
        minnie.showAllUTXOs();
        readUserInput();
        break;
      case 'f':
        rl.question(`Max Retries: `, (attempts) => {
          minnie.recoverFunds(attempts);
          readUserInput();
        });
        break;
      default:
        console.log(`Unrecognized choice: ${answer}`);
    }
    console.log();
    setTimeout(readUserInput, 0);
  });
}

readUserInput();

