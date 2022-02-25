import React from 'react';
import Web3 from 'web3';
import './App.css';

// https://api.coingecko.com/api/v3/coins/list?include_platform=true
import tokenList from './tokenlist.json';
import erc20abi from './erc20.abi.json';
import { Checkbox, Input, Button, Container, Header, Table, Message, List } from 'semantic-ui-react'
import { DateTimeInput } from 'semantic-ui-calendar-react';
import moment from 'moment';

const dateTimeFormat = "DD-MM-YYYY HH:mm Z";
const nativeTokens = {
  "ethereum": "eth",
  "polygon-pos": "matic",
};
const nativeTokenIds = {
  "ethereum": "ethereum",
  "polygon-pos": "matic-network",
};


class App extends React.Component {

  constructor(props) {
    super(props);

    // this.web3Eth = new Web3(new Web3.providers.HttpProvider("https://mainnet.infura.io/v3/06be4b923b9446b8bec846a81e356f81")); 
    this.web3Eth = new Web3(new Web3.providers.HttpProvider("https://eth-mainnet.alchemyapi.io/v2/fJR25Od4foGhVrli2OCxRjmP5pkNhg1O")); 
    this.web3s = {
      "ethereum": this.web3Eth,
      "polygon-pos": new Web3(new Web3.providers.HttpProvider("https://polygon-mainnet.g.alchemy.com/v2/4IApMoKFRmy2g8eFrFV9uGxBf6j8wM7Y")),
      // "binance-smart-chain": new Web3(new Web3.providers.HttpProvider("https://bsc-dataseed.binance.org/")),
    };

    this.fetchBalances = this.fetchBalances.bind(this);
    this.reportError = this.reportError.bind(this);
    this.fetchHistoryPrice = this.fetchHistoryPrice.bind(this);
    this.fetchCurrentPrice = this.fetchCurrentPrice.bind(this);

    this.state = {
      balances: [],
      nearestBlocks: {},
      time: undefined,
      blocks: {},
      address: window.localStorage.getItem("address"),
      useCurrentPrice: false,
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
      totalBalance: 0,
      nearestBlocks: {},
    });
    
    if (!this.web3Eth.utils.isAddress(this.state.address)) {
      this.reportError("Wrong address");
      return;
    }
    window.localStorage.setItem("address", this.state.address);

    try {
      let time = moment(this.state.time, dateTimeFormat).toDate().getTime() / 1000;
      let nearestBlocks = {};
      for (let k in this.web3s) {
        let block = this.state.blocks[k] || (time ? await this.findNearstBlock(this.web3s[k], time) : (await this.web3s[k].eth.getBlockNumber()));
        let blockTime = (await this.web3s[k].eth.getBlock(block)).timestamp;
        nearestBlocks[k] = {
          "block": block,
          "time": blockTime,
        };
      };
      this.setState({nearestBlocks});

      this.jobs = 0;
      
      // Native tokens
      for (let k in this.web3s) {
          let block = nearestBlocks[k]?.block ?? "latest";
          this.web3s[k].eth.getBalance(this.state.address, block, async (err, balanceRaw) => {
            if (err) {
              console.log(err, this.state.address, block);
              // this.reportError(err.message, false);
            } else if (balanceRaw && balanceRaw !== "0") {
              let balance = this.web3s[k].utils.fromWei(balanceRaw);

              let datetime = this.formatDate(nearestBlocks[k].time);
              let price = await (this.state.useCurrentPrice ? this.fetchCurrentPrice(nativeTokenIds[k]) : this.fetchHistoryPrice(nativeTokenIds[k], datetime));

              this.setState({balances: [
                ...this.state.balances,
                {
                  chain: k,
                  block: block,
                  time: nearestBlocks[k].time,
                  tokenSymbol: nativeTokens[k],
                  tokenName: k,
                  contract: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
                  balance: balance,
                  price: price,
                }
              ]})
            }
          })
      }
      
      // Fetch by batchs
      let batchSize = 50;
      for (let i = 0; i < tokenList.length; i+=batchSize) {
        let batches = {};
        for (let k in this.web3s) {
          batches[k] = new this.web3s[k].BatchRequest();
        }

        for (let j = i; j < tokenList.length && j < i+batchSize; j += 1) {
          let {id, symbol, name, platforms} = tokenList[j];
          
          for (let k in this.web3s) {
            let datetime = this.formatDate(nearestBlocks[k].time);
            
            if (platforms[k]) {
              let block = nearestBlocks[k]?.block ?? "latest";
              let contractAddress = platforms[k].trim();
              let contract = new this.web3s[k].eth.Contract(erc20abi, contractAddress);

              this.jobs ++;
              batches[k].add(
                contract.methods.balanceOf(this.state.address).call.request({}, block, async (err, balanceRaw) => {
                  if (err) {
                    console.log(err, contractAddress, this.state.address, block);
                    // this.reportError(err.message, false);
                  } else if (balanceRaw && balanceRaw !== "0") {
                    let price = await (this.state.useCurrentPrice ? this.fetchCurrentPrice(id) : this.fetchHistoryPrice(id, datetime));

                    let decimals = await contract.methods.decimals().call();
                    let divisor = this.web3s[k].utils.toBN(10).pow(this.web3s[k].utils.toBN(decimals));
                    let dec = this.web3s[k].utils.toBN(balanceRaw).div(divisor);
                    let fra = this.web3s[k].utils.toBN(balanceRaw).mod(divisor);
                    let balance = dec.toString() + "." + fra.toString();

                    ;
                    this.setState({totalBalance: this.state.totalBalance + (price??0) * balance, balances: [
                      ...this.state.balances,
                      {
                        chain: k,
                        block: block,
                        time: datetime,
                        tokenSymbol: symbol,
                        tokenName: name,
                        contract: contractAddress,
                        balance: balance,
                        price: price,
                      }
                    ]})
                    console.log(symbol, name, contractAddress, err, balanceRaw, decimals, balance, price);
                  }
                  this.jobs --;
                  if (this.jobs === 0) {
                    this.setState({fetching: false});
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


  async fetchHistoryPrice(id, date) {
    let url = `https://api.coingecko.com/api/v3/coins/${id}/history?date=${date}`;
    let data = await fetch(url);
    let dataJson = await data.json();
    return dataJson?.market_data?.current_price?.usd;
  }

  async fetchCurrentPrice(id) {
    let url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`;
    let data = await fetch(url);
    let dataJson = await data.json();
    return dataJson?.[id]?.usd;
  }

  formatDate(date) {
    var dateOffset = 24*60*60*1000; //1 days
    // Get price from the previous day
    var d = new Date(date * 1000 - dateOffset),
        month = '' + (d.getMonth() + 1),
        day = '' + d.getDate(),
        year = d.getFullYear();

    if (month.length < 2) 
        month = '0' + month;
    if (day.length < 2) 
        day = '0' + day;

    return [day, month, year].join('-');
}


  reportError(err, stopFetching=false) {
    this.setState({
      fetching: stopFetching,
      error: err,
    });
  }

  render() {
    return (
      <div className="App">
        <Container tectclassName="App-header">
          <Message positive>
            <Message.Header>Welcome </Message.Header>
            <List as='ul'>
              <List.Item as='li'>Fetching balances by datetime may take time, please be patient</List.Item>
              <List.Item as='li'>Leaving the datetime and block empty for the latest block data</List.Item>
              <List.Item as='li'>Block is used if both block and datetime exist</List.Item>
              <List.Item as='li'>USD Price is at the previous-day of the current selected day by default</List.Item>
            </List>

            <i>If you have any issue, ping me at <a href = "mailto: nvdung149@gmail.com">nvdung149@gmail.com</a></i>
          </Message>
          
          <Input value={this.state.address} disabled={this.state.fetching} placeholder='Input the address to check ...' size="large" fluid focus icon="search" onChange={(e, data) => {
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
          <span className="white">
            <Checkbox 
              label={"Use the current token USD price"} 
              checked={this.state.useCurrentPrice} 
              disabled={this.state.fetching}
              onClick={() => {
                this.setState({useCurrentPrice: !this.state.useCurrentPrice})
              }}
            />
          </span>
          <br/>

          <br/>
          <div style={{display: "flex"}}>
            {Object.keys(this.web3s).map(chain => (
              <div style={{paddingRight: "20px"}} key={chain}>
                <b>{`${chain}`}</b>
                <br/>
                <Input disabled={this.state.fetching} placeholder={`${chain} block`} size="large" type="number" onChange={(e, data) => {
                  this.setState({ blocks: {...this.state.blocks, [chain]: data.value} });
                }}/> 
              </div> 
            ))}
          </div>

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
          <b>TOTAL VALUE: ${this.state.totalBalance ?? 0}</b>

          <br/>
          <b>Price is snapshot on: {this.state.useCurrentPrice ? "REAL-TIME" : (
            Object.values(this.state.nearestBlocks)?.[0]?.time ? this.formatDate(Object.values(this.state.nearestBlocks)?.[0]?.time) : ""
          )}</b>

          <br/>
          <Table celled>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Chain</Table.HeaderCell>
                <Table.HeaderCell>Block</Table.HeaderCell>
                <Table.HeaderCell>Date</Table.HeaderCell>
                <Table.HeaderCell>Token name</Table.HeaderCell>
                <Table.HeaderCell>Price (USD)</Table.HeaderCell>
                <Table.HeaderCell>Balance</Table.HeaderCell>
                <Table.HeaderCell>Total Value (USD)</Table.HeaderCell>
                <Table.HeaderCell>Token symbol</Table.HeaderCell>
                <Table.HeaderCell>Contract</Table.HeaderCell>
              </Table.Row>
            </Table.Header>

            <Table.Body>
              {this.state.balances.map(({chain, time, price, block, tokenSymbol, tokenName, balance, contract}) => (
                <Table.Row>
                  <Table.Cell>{chain}</Table.Cell>
                  <Table.Cell>{block}</Table.Cell>
                  <Table.Cell>{time}</Table.Cell>
                  <Table.Cell>{tokenName}</Table.Cell>
                  <Table.Cell>${price?.toFixed(2) ?? "-"}</Table.Cell>
                  <Table.Cell>{balance}</Table.Cell>
                  <Table.Cell>${(price ?? 0) * balance}</Table.Cell>
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
