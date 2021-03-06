const fs = require('fs');
const nearAPI = require('near-api-js');
const testUtils = require('./test-utils');
const getConfig = require('../src/config');

const { 
    Contract, KeyPair, Account,
    utils: { format: { parseNearAmount }},
    transactions: { deployContract, functionCall },
} = nearAPI;
const { 
	connection, initContract, getAccount, getAccountBalance,
	contract, contractAccount, contractName, contractMethods, createAccessKeyAccount,
	createOrInitAccount,
    getContract,
} = testUtils;
const { 
	networkId, GAS, GUESTS_ACCOUNT_SECRET
} = getConfig();

jasmine.DEFAULT_TIMEOUT_INTERVAL = 50000;

describe('deploy contract ' + contractName, () => {
    let alice, aliceId, bob, bobId,
        stableAccount, marketAccount,
        storageMinimum, storageMarket;

    const metadata = {
        media: 'https://media1.tenor.com/images/4c1d96a989150e7019bfbabbebd2ff36/tenor.gif?itemid=20269144'
    }
    const metadata2 = {
        media: 'https://media1.tenor.com/images/818161c07948bac34aa7c5f5712ec3d7/tenor.gif?itemid=15065455'
    }

    const tokenIds = [
        'token' + Date.now(),
        'token' + Date.now() + 1,
        'token' + Date.now() + 2
    ]

    /// contractAccount.accountId is the NFT contract and contractAccount is the owner
    /// see initContract in ./test-utils.js for details
    const contractId = contractAccount.accountId
    /// the fungible token "stablecoin" contract
    const stableId = 'stable.' + contractId;
    /// the market contract
    const marketId = 'market.' + contractId;

	beforeAll(async () => {
	    await initContract();

		alice = await getAccount();
        aliceId = alice.accountId;
		console.log('\n\n Alice accountId:', aliceId, '\n\n');

        bob = await getAccount();
        bobId = bob.accountId;
		console.log('\n\n Bob accountId:', bobId, '\n\n');
		
        /// create or get stableAccount and deploy ft.wasm (if not already deployed)
		stableAccount = await createOrInitAccount(stableId, GUESTS_ACCOUNT_SECRET);
        const stableAccountState = await stableAccount.state()
		console.log('\n\nstate:', stableAccountState, '\n\n');
        if (stableAccountState.code_hash === '11111111111111111111111111111111') {
            const fungibleContractByes = fs.readFileSync('./out/ft.wasm');
            console.log('\n\n deploying stableAccount contractBytes:', fungibleContractByes.length, '\n\n');
            const newFungibleArgs = {
                /// will have totalSupply minted to them
                owner_id: contractName,
                total_supply: parseNearAmount('1000000'),
                name: 'Test Stable Coin',
                symbol: 'TSC',
                // not set by user request
                version: '1',
                reference: 'https://github.com/near/core-contracts/tree/master/w-near-141',
                reference_hash: '7c879fa7b49901d0ecc6ff5d64d7f673da5e4a5eb52a8d50a214175760d8919a',
                decimals: 24,
            };
            const actions = [
                deployContract(fungibleContractByes),
                functionCall('new', newFungibleArgs, GAS)
            ]
            await stableAccount.signAndSendTransaction(stableId, actions)
        }
        /// find out how much needed to store for FTs
        storageMinimum = await contractAccount.viewFunction(stableId, 'storage_minimum_balance')
		console.log('\n\n storageMinimum:', storageMinimum, '\n\n');

        /// create or get market account and deploy market.wasm (if not already deployed)
		marketAccount = await createOrInitAccount(marketId, GUESTS_ACCOUNT_SECRET);
        const marketAccountState = await marketAccount.state()
		console.log('\n\nstate:', marketAccountState, '\n\n');
        if (marketAccountState.code_hash === '11111111111111111111111111111111') {
            const marketContractBytes = fs.readFileSync('./out/market.wasm');
            console.log('\n\n deploying marketAccount contractBytes:', marketContractBytes.length, '\n\n');
            const newMarketArgs = {
                owner_id: contractId
            }
            const actions = [
                deployContract(marketContractBytes),
                functionCall('new', newMarketArgs, GAS)
            ]
            await marketAccount.signAndSendTransaction(marketId, actions)
        }
        const supported = await marketAccount.viewFunction(marketId, "supports_token", { token_contract_id: stableId });
        console.log('\n\n market supports token:', stableId, supported, '\n\n');
        if (!supported) {
            await marketAccount.functionCall(stableId, 'storage_deposit', {}, GAS, storageMinimum)
            const added = await contractAccount.functionCall(marketId, "add_token", { token_contract_id: stableId }, GAS);
            console.log('\n\n added token:', stableId, '\n\n');
        }

        /// find out how much needed for market storage
        storageMarket = await contractAccount.viewFunction(marketId, 'storage_amount')
		console.log('\n\n storageMarket:', storageMarket, '\n\n');
	});

    test('alice gets 100 fts', async () => {
		await alice.functionCall(stableId, 'storage_deposit', {}, GAS, storageMinimum);
		let amount = parseNearAmount('100');
		await contractAccount.functionCall(stableId, 'ft_transfer', {
			receiver_id: aliceId,
			amount
		}, GAS, 1);
		/// check balance
		const balance = await contractAccount.viewFunction(stableId, 'ft_balance_of', { account_id: aliceId });
		expect(balance).toEqual(amount);
	});

    test('bob: ft storage, market storage, nft mint, approve sale with ft', async () => {
        const token_id = tokenIds[0]
		await bob.functionCall(stableId, 'storage_deposit', {}, GAS, storageMinimum);
        await bob.functionCall(marketId, 'storage_deposit', {}, GAS, storageMarket);
		await bob.functionCall(contractId, 'nft_mint', { token_id, metadata }, GAS, parseNearAmount('1'));
        await bob.functionCall(contractId, 'nft_approve', {
            token_id,
            account_id: marketId,
            msg: JSON.stringify({
                beneficiary: bobId,
                ft_token_id: stableId,
                price: parseNearAmount('25')
            })
        }, GAS, parseNearAmount('0.1001'));
        const token = await contract.nft_token({ token_id });
        const sale = await bob.viewFunction(marketId, 'get_sale', { token_contract_id: contractId, token_id });
		console.log('\n\n', sale, '\n\n');
        expect(sale.price).toEqual(parseNearAmount('25'))
        expect(sale.ft_token_id).toEqual(stableId)
        expect(token.owner_id).toEqual(bobId)
	});

	test('bob changes price', async () => {
        const token_id = tokenIds[0]
		await bob.functionCall(marketId, 'update_price', { token_contract_id: contractId, token_id, price: parseNearAmount('20') }, GAS);
        const sale = await bob.viewFunction(marketId, 'get_sale', { token_contract_id: contractId, token_id });
		console.log('\n\n', sale, '\n\n');
        expect(sale.price).toEqual(parseNearAmount('20'))
	});

	test('alice purchase nft with ft', async () => {
        const token_id = tokenIds[0]
        /// purchase = ft_transfer_call -> market: ft_on_transfer -> nft_transfer
		await alice.functionCall(stableId, 'ft_transfer_call', {
            receiver_id: marketId,
            amount: parseNearAmount('20'),
            msg: JSON.stringify({
                token_contract_id: contractName,
                token_id,
            })
        }, GAS, 1);
        /// check owner
        const token = await contract.nft_token({ token_id });
        expect(token.owner_id).toEqual(aliceId)
        /// check token balances
		const aliceBalance = await alice.viewFunction(stableId, 'ft_balance_of', { account_id: aliceId });
		expect(aliceBalance).toEqual(parseNearAmount('80'));
        const marketBalance = await marketAccount.viewFunction(stableId, 'ft_balance_of', { account_id: marketId });
		console.log('\n\n marketBalance', marketBalance, '\n\n');
		const bobBalance = await bob.viewFunction(stableId, 'ft_balance_of', { account_id: bobId });
		expect(bobBalance).toEqual(parseNearAmount('20'));
	});

});