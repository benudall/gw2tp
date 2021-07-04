#!/usr/bin/env nodejs
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const fs = require('fs');

delay = ms => {
	return new Promise(resolve => setTimeout(resolve, ms));
}

var server = http.createServer(async (request, result) => {
	console.log((new Date()).toLocaleTimeString() + ' RECEIVED ' + request.method + " " + request.url);

	if (request.url == '/') {
		fs.readFile('index.html', function (error, data) {
			if (error) { console.log(error); result.end('Error: cannot return page') }
			else { result.end(data) }
		});
	}
	else if (request.url == '/get/itemNames') {
		fetch("https://api.gw2tp.com/1/bulk/items-names.json")
			.then(res => res.json()
				.catch(err => {
					console.error(err);
				}))
			.then(async itemNames => {
				fs.writeFileSync("data/itemNames.json", JSON.stringify(itemNames, null, "\t"));
				result.end(JSON.stringify(itemNames));
			})
	}
	else if (request.url == '/data/filteredRecipes') {
		fs.readFile('data/filteredRecipes.json', function (error, data) {
			if (error) { console.error(error); result.end('Error: cannot return page') }
			else { result.end(data) }
		});
	}
	else {
		console.error("404")
		result.writeHead("404");
		result.end("404 Error");
	}
});
var port = 8080;
server.listen(port);
console.log('Listening on http://127.0.0.1:' + port);

errFunc = err => {
	if (err) {
		console.error("err", err);
		throw err;
	}
}

log = (websocket, message) => {
	websocket.send(JSON.stringify(message));
	console.log(message);
}

const wss = new WebSocket.Server({ port: 8081 });
wss.on('connection', async function connection(ws) {
	ws.on('close', function incoming(data) {
		console.log(new Date().toJSON(), "WS connection closed");
	});

	log(ws, { message: "Fetching cached item names", progress: 5 });

	var itemNames = JSON.parse(fs.readFileSync("data/itemNames.json")).items;

	log(ws, { message: "Fetching listings", progress: 10 });
	var rawListings = await fetch("http://api.gw2tp.com/1/bulk/items.json")
		.then(res => res.json()
			.catch(err => {
				console.error(err);
			}))
		.then(res => { return res });

	log(ws, { message: "Converting listings", progress: 15 });

	var listings = {};
	var _id = rawListings.columns.indexOf("id");
	var _buy = rawListings.columns.indexOf("buy");
	var _sell = rawListings.columns.indexOf("sell");
	var _supply = rawListings.columns.indexOf("supply");
	var _demand = rawListings.columns.indexOf("demand");
	rawListings.items.forEach(listing => {
		var name = itemNames.filter(x => x[0] == listing[_id]);
		if (name.length == 0) {
			console.error("No name found for " + listing[_id]);
			result.end("No name found for " + listing[_id]);
			return;
		}
		listingEntry = {
			name: itemNames.filter(x => x[0] == listing[_id])[0][1],
			buy: listing[_buy],
			sell: listing[_sell],
			supply: listing[_supply],
			demand: listing[_demand],
		}
		listings[listing[_id]] = listingEntry;
	});

	log(ws, { message: "Fetching cached recipes", progress: 20 });

	var recipes = JSON.parse(fs.readFileSync("data/recipes.json"));

	log(ws, { message: "Filtering recipes", progress: 25 });

	var filteredRecipes = Object.entries(recipes).filter(recipe => {
		// Are the output and ingredients tradable?
		var outputListing = listings[recipe[1].output_item_id];
		if (outputListing == undefined) { return }
		recipe[1].output = listings[recipe[1].output_item_id];
		var tradableIngredients = true;
		recipe[1].ingredients.forEach(ingredient => {
			var ingredientListing = listings[ingredient.item_id];
			if (ingredientListing == undefined) { tradableIngredients = false; return }
			ingredient.data = listings[ingredient.item_id];
		})
		if (!tradableIngredients) { return }
		return recipe;
	}).filter(recipe => {
		// Is the recipe not learned from an item?
		var LearnedFromItem = recipe[1].flags.indexOf("LearnedFromItem") >= 0;
		if (LearnedFromItem) { return }
		return recipe;
	}).filter(recipe => {
		// Is the recipe fully available?
		var ingredientsAvaiable = true;
		recipe[1].ingredients.forEach(ingredient => {
			if (ingredient.data.sell == 0) { ingredientsAvaiable = false; return }
		});
		if (!ingredientsAvaiable) { return }
		return recipe;
	}).map(recipe => {
		// Adding totalCost, totalRevenue and profit
		recipe[1].totalCost = recipe[1].ingredients.map(ingredient => {
			return ingredient.data.sell * ingredient.count;
		}).reduce((a, b) => a + b);
		recipe[1].totalRevenue = recipe[1].output.buy;
		recipe[1].profit = recipe[1].totalRevenue * 0.85 - recipe[1].totalCost;
		return recipe;
	}).filter(recipe => {
		// Is the recipe profitable?
		if (recipe[1].profit <= 0) { return }
		return recipe;
	})

	log(ws, { message: "Recipes filterd to " + Object.keys(filteredRecipes).length, progress: 30 });

	var outputAndIngredientIds = filteredRecipes.map(recipe => {
		return [recipe[1].output_item_id].concat(recipe[1].ingredients.map(ingredient => ingredient.item_id))
	}).join(",");

	log(ws, { message: "Fetching item data", progress: 35 });

	var itemData = await fetch("https://api.guildwars2.com/v2/items?ids=" + outputAndIngredientIds)
		.then(res => res.json()
			.catch(err => {
				console.error(err);
			}))
		.then(items => {
			return items;
		});

	log(ws, { message: "Item data fetched", progress: 40 });

	// Getting item rarities and icons
	filteredRecipes.map(recipe => {
		var outputItem = itemData.filter(item => item.id == recipe[1].output_item_id)[0];
		recipe[1].rarity = outputItem.rarity;
		recipe[1].icon = outputItem.icon;
		recipe[1].ingredients.map(ingredient => {
			var ingredientItem = itemData.filter(item => item.id == ingredient.item_id)[0];
			ingredient.data.rarity = ingredientItem.rarity;
			ingredient.data.icon = ingredientItem.icon;
			return ingredient;
		})
		return recipe;
	});

	log(ws, { message: "Fetching full listings", progress: 45 });

	var fullListings = await fetch("https://api.guildwars2.com/v2/commerce/listings?ids=" + outputAndIngredientIds)
		.then(res => res.json()
			.catch(err => {
				console.error(err);
			}))
		.then(res => { return res })

	log(ws, { message: "Calculating full profits", progress: 50 });
	var progress = 0;
	filteredRecipes.map(async recipe => {
		// Calculating total profits
		// Building list of ingredient for sale
		var ingredientsSells = {};
		recipe[1].ingredients.forEach(ingredient => {
			var ingredientListing = fullListings.filter(listing => ingredient.item_id == listing.id)[0];
			var sells = [];
			ingredientListing.sells.forEach(sell => {
				for (count = 0; count < sell.quantity; count++) {
					sells.push(sell.unit_price)
				}
			});
			ingredientsSells[ingredient.item_id] = sells;
		});

		// Building list of output orders
		var outputListing = fullListings.filter(listing => recipe[1].output_item_id == listing.id)[0];
		var outputBuys = [];
		outputListing.buys.forEach(buy => {
			for (count = 0; count < buy.quantity; count++) {
				outputBuys.push(buy.unit_price)
			}
		})

		var minAvailablity = Math.min(outputBuys.length, ...Object.values(ingredientsSells).map(ingredientSells => ingredientSells.length));
		recipe[1].totalProfit = 0;
		recipe[1].sellCount = 0;
		// Counting total profit for repeat crafting
		for (var j = 0; j < minAvailablity; j++) {
			var cost = 0;
			recipe[1].ingredients.forEach(ingredient => {
				for (var i = 0; i < ingredient.count; i++) {
					var index = j * ingredient.count + i;
					cost += ingredientsSells[ingredient.item_id][index];
				}
			});
			var revenue = outputBuys[j];
			var profit = revenue * 0.85 - cost;
			if (profit <= 0) { break }
			recipe[1].totalProfit += profit;
			recipe[1].sellCount += 1;
		}
		var progressPercent = 50 + ++progress / filteredRecipes.length * 50;
		log(ws, { message: progress + "/" + filteredRecipes.length + " Finished counting total profit for " + recipe[1].output.name, progress: progressPercent })
		return recipe;
	});

	while (progress < filteredRecipes.length) {
		await delay(1000);
	}

	fs.writeFileSync("data/filteredRecipes.json", JSON.stringify(filteredRecipes, null, "\t"));
	log(ws, { message: "Finished at " + new Date(), progress: 100 });
	ws.close();
});