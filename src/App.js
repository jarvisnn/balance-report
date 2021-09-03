import React from 'react';
import Web3 from 'web3';
import './App.css';
import tokenList from './tokenlist.json';
import erc20abi from './erc20.abi.json';
import { Input, Button, Container, Header, Table } from 'semantic-ui-react'
import { DateTimeInput } from 'semantic-ui-calendar-react';
import moment from 'moment';

const dateTimeFormat = "DD-MM-YYYY HH:mm Z";
class App extends React.Component {

  constructor(props) {
    super(props);

    this.web3Eth = new Web3(new Web3.providers.HttpProvider("https://mainnet.infura.io/v3/06be4b923b9446b8bec846a81e356f81")); 
    this.web3s = {
      "ethereum": this.web3Eth,
      "polygon-pos": new Web3(new Web3.providers.HttpProvider("https://polygon-mainnet.infura.io/v3/06be4b923b9446b8bec846a81e356f81")),
    };

    this.fetchBalances = this.fetchBalances.bind(this);
    this.reportError = this.reportError.bind(this);

    this.state = {
      balances: [],
      nearestBlocks: {},
    }
  }

  async findNearstBlock(web3, unixTime) {
    let l = 0;
    let h = await web3.eth.getBlockNumber();
    
    while (l < h) {
      let m = Math.floor((l + h) / 2);
      let t = (await web3.eth.getBlock(m)).timestamp;
      if (t === unixTime) return m;
      if (t > unixTime) h = m - 1;
        else l = m + 1;
    }
    return l;
  }

  async fetchBalances() {
    this.setState({
      fetching: true,
      error: undefined,
      balances: [],
      nearestBlocks: {},
    });
    
    if (!this.web3Eth.utils.isAddress(this.state.address)) {
      this.reportError("Wrong address");
      return;
    }

    if (!this.state.time) {
      this.reportError("Missing time");
      return;
    }

    try {
      let time = moment(this.state.time, dateTimeFormat).toDate().getTime() / 1000;
      let nearestBlocks = {};
      for (let k in this.web3s) {
        let block = await this.findNearstBlock(this.web3s[k], time);
        let blockTime = (await this.web3s[k].eth.getBlock(block)).timestamp;
        nearestBlocks[k] = {
          "block": block,
          "time": blockTime,
        };
      };
      this.setState({nearestBlocks});

      // Fetch by batchs of 100
      for (let i = 0; i < tokenList.length; i+=100) {
        let batches = {};
        for (let k in this.web3s) {
          batches[k] = new this.web3s[k].BatchRequest();
        }

        for (let j = i; j < tokenList.length && j < i+100; j += 1) {
          let {symbol, name, platforms} = tokenList[j];
          
          for (let k in this.web3s) {
            if (platforms[k]) {
              let contractAddress = platforms[k].trim();
              let contract = new this.web3s[k].eth.Contract(erc20abi, contractAddress);
              batches[k].add(
                contract.methods.balanceOf(this.state.address).call.request({}, async (err, balanceRaw) => {
                  if (balanceRaw !== "0") {
                    let decimals = await contract.methods.decimals().call();
                    let divisor = this.web3s[k].utils.toBN(10).pow(this.web3s[k].utils.toBN(decimals));
                    let dec = this.web3s[k].utils.toBN(balanceRaw).div(divisor);
                    let fra = this.web3s[k].utils.toBN(balanceRaw).mod(divisor);
                    let balance = dec.toString() + "." + fra.toString();

                    this.setState({balances: [
                      ...this.state.balances,
                      {
                        chain: k,
                        block: nearestBlocks[k],
                        tokenSymbol: symbol,
                        tokenName: name,
                        contract: contractAddress,
                        balance: balance,
                      }
                    ]})
                    console.log(symbol, name, contractAddress, err, balanceRaw, decimals, balance);
                  }
                })
              );
            }
          }
        }

        for (let k in this.web3s) {
          batches[k].execute();
        }
      };

    } catch (e) {
      this.reportError(e.message);
    }
  }


  reportError(err) {
    this.setState({
      fetching: false,
      error: err,
    });
  }

  render() {
    return (
      <div className="App">
        <Container tectclassName="App-header">
          <Input disabled={this.state.fetching} placeholder='Input the address to check ...' size="large" fluid focus icon="search" onChange={(e, data) => {
            this.setState({ address: data.value });
          }}/>  
          <br/>
          <DateTimeInput
            fluid
            name="Select time"
            placeholder="Select time"
            value={this.state.time}
            iconPosition="left"
            dateTimeFormat={dateTimeFormat}
            onChange={(e, data) => {
              this.setState({ time: data.value });
            }}
            disabled={this.state.fetching}
          />
          <br/>
          <Button inverted color='green' content='Get Balances' fluid disabled={this.state.fetching} loading={this.state.fetching} onClick={this.fetchBalances}/>

          {this.state.error && 
            <Header as='h5' textAlign='center' inverted color='red'>
              {this.state.error}
            </Header>
          }

          <br/>
          <div>
            {Object.keys(this.state.nearestBlocks).map((k) => {
              return (
                <p key={k}>
                  <span>{k}: </span>
                  <span>Block {this.state.nearestBlocks[k].block}</span>
                  <span>- Estimated time: {new Date(this.state.nearestBlocks[k].time * 1000).toString()}</span>
                </p>
              );
            })}
          </div>

          <br/>
          <Table celled>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Chain</Table.HeaderCell>
                <Table.HeaderCell>Block</Table.HeaderCell>
                <Table.HeaderCell>Token name</Table.HeaderCell>
                <Table.HeaderCell>Balance</Table.HeaderCell>
                <Table.HeaderCell>Token symbol</Table.HeaderCell>
                <Table.HeaderCell>Contract</Table.HeaderCell>
              </Table.Row>
            </Table.Header>

            <Table.Body>
              {this.state.balances.map(({chain, block, tokenSymbol, tokenName, balance, contract}) => (
                <Table.Row>
                  <Table.Cell>{chain}</Table.Cell>
                  <Table.Cell>{block}</Table.Cell>
                  <Table.Cell>{tokenName}</Table.Cell>
                  <Table.Cell>{balance}</Table.Cell>
                  <Table.Cell>{tokenSymbol.toUpperCase()}</Table.Cell>
                  <Table.Cell>{contract}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>

        </Container>
      </div>
    );
  }
}


export default App;
