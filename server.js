#!/usr/bin/env nodejs
const http = require('http');
const fetch = require('node-fetch');
const fs = require('fs');

var server = http.createServer(async (request, result) => {
    console.log((new Date()).toLocaleTimeString() + ' RECEIVED ' + request.method + " " + request.url);

    if (request.url == '/') {
        fs.readFile('index.html', function (error, data) {
            if (error) { console.log(error); result.end('Error: cannot return page') }
            else { result.end(data) }
        });
    }
    else if (request.url == '/get/listings') {
        var itemNames = JSON.parse(fs.readFileSync("data/itemNames.json")).items;
        fetch("http://api.gw2tp.com/1/bulk/items.json")
            .then(res => res.json()
                .catch(err => {
                    console.error(err);
                }))
            .then(async rawListings => {
                fs.writeFileSync("data/rawListings.json", JSON.stringify(rawListings, null, "\t"));
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
                fs.writeFileSync("data/listings.json", JSON.stringify(listings, null, "\t"));
                result.end(JSON.stringify(listings));
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
    else if (request.url == '/get/filteredRecipes') {


        var recipes = JSON.parse(fs.readFileSync("data/recipes.json"));
        var listings = JSON.parse(fs.readFileSync("data/listings.json"));
        var tradable = {};
        Object.entries(recipes).forEach(recipe => {
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
            tradable[recipe[1].id] = recipe[1];
        });
        console.log("recipes has length:", Object.keys(recipes).length);
        console.log("tradable has length:", Object.keys(tradable).length);

        var recipesNotFromItems = {};
        Object.entries(tradable).forEach(recipe => {
            var LearnedFromItem = recipe[1].flags.indexOf("LearnedFromItem") >= 0;
            if (LearnedFromItem) { return }
            recipesNotFromItems[recipe[1].id] = recipe[1];
        });

        console.log("recipesNotFromItems has length:", Object.keys(recipesNotFromItems).length);

        Object.entries(recipesNotFromItems).forEach(recipe => {
            recipe[1].totalCost = recipe[1].ingredients.map(ingredient => {
                return ingredient.data.sell * ingredient.count;
            }).reduce((a, b) => a + b);
            recipe[1].totalRevenue = recipe[1].output.buy;
            recipe[1].profit = recipe[1].totalRevenue * 0.85 - recipe[1].totalCost;
        });

        var recipesFullyAvailable = {};
        Object.entries(recipesNotFromItems).forEach(recipe => {
            var ingredientsAvaiable = true;
            recipe[1].ingredients.forEach(ingredient => {
                if (ingredient.data.sell == 0) { ingredientsAvaiable = false; return }
            });
            if (!ingredientsAvaiable) { return }
            recipesFullyAvailable[recipe[1].id] = recipe[1];
        });

        var profitableRecipes = {}
        Object.entries(recipesFullyAvailable).forEach(recipe => {
            if (recipe[1].profit <= 0) { return }
            profitableRecipes[recipe[1].id] = recipe[1];
        })

        console.log("profitableRecipes has length:", Object.keys(profitableRecipes).length);


        var recipesWithTotalProfit = {}
        await fetch("https://api.guildwars2.com/v2/commerce/listings?ids=" + Object.entries(profitableRecipes).map(recipe => recipe[1].output_item_id).join(","))
            .then(res => res.json()
                .catch(err => {
                    console.error(err);
                }))
            .then(fullListings => {
                fullListings.forEach(fullListing => {
                    var recipe = Object.entries(profitableRecipes).filter(recipe => recipe[1].output_item_id == fullListing.id)[0];
                    recipe[1].buys = fullListing.buys;
                    // profitableRecipes[fullListing.id].sells = fullListing.sells;
                    var totalProfit = 0;
                    var sellCount = 0;
                    // fullListing.buys.forEach(listing => {
                    fullListing.buys.forEach(buy => {
                        if (buy.unit_price * 0.85 <= recipe[1].totalCost) { return }
                        totalProfit += (buy.unit_price * 0.85 - recipe[1].totalCost) * buy.listings;
                        sellCount += buy.listings;
                    });
                    recipe[1].totalProfit = totalProfit;
                    recipe[1].sellCount = sellCount;
                    recipesWithTotalProfit[recipe[0]] = recipe[1];
                });
            });

        var sortedRecipes = Object.entries(recipesWithTotalProfit).sort((a, b) => b[1].profit - a[1].profit);


        fs.writeFileSync("data/filteredRecipes.json", JSON.stringify(sortedRecipes, null, "\t"));
        result.end(JSON.stringify(sortedRecipes));
    }
    else if (request.url == '/data/rawListings') {
        fs.readFile('data/rawListings.json', function (error, data) {
            if (error) { console.log(error); result.end('Error: cannot return page') }
            else { result.end(data) }
        });
    }
    else if (request.url == '/data/listings') {
        fs.readFile('data/listings.json', function (error, data) {
            if (error) { console.log(error); result.end('Error: cannot return page') }
            else { result.end(data) }
        });
    }
    else if (request.url == '/data/itemNames') {
        fs.readFile('data/itemNames.json', function (error, data) {
            if (error) { console.log(error); result.end('Error: cannot return page') }
            else { result.end(data) }
        });
    }
    else if (request.url == '/data/recipes') {
        fs.readFile('data/recipes.json', function (error, data) {
            if (error) { console.log(error); result.end('Error: cannot return page') }
            else { result.end(data) }
        });
    }
    else if (request.url == '/data/filteredRecipes') {
        fs.readFile('data/filteredRecipes.json', function (error, data) {
            if (error) { console.log(error); result.end('Error: cannot return page') }
            else { result.end(data) }
        });
    }
    else {
        console.log("404")
        result.writeHead("404");
        result.end("404 Error");
    }
});
var port = 8080;
server.listen(port);
console.log('Listening on http://127.0.0.1:' + port);