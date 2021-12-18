require('dotenv').config();
const axios = require('axios').default; // Ensures we get autocompletion
const TezosToolkit = require("@taquito/taquito").TezosToolkit;
const InMemorySigner = require("@taquito/signer").InMemorySigner;

const Tezos = new TezosToolkit(process.env.TEZOS_RPC);

function normalize(input) {
    return input.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function timeRange(date, secondsForward, secondsBackward) {
    const forward = new Date();
    const backward = new Date();
    forward.setTime(date.getTime() + secondsForward * 1000);
    backward.setTime(date.getTime() - secondsBackward * 1000);
    
    return { forward: forward, backward: backward };
}

async function TezosSelfSign() {
    await InMemorySigner.fromSecretKey(process.env.TEZOS_ADMIN)
        .then((signer) => {
            Tezos.setProvider({ signer: signer });
        }).catch(console.log);
}

async function loadContractStorage() {
    return Tezos.contract
        .at(process.env.TEZBET_CONTRACT)
        .then((contract) => contract.storage())
        .then((s) => {
            const games = {};
            s.games.valueMap.forEach((x, id) => {
                games[s.games.keyMap.get(id)] = {
                    outcome: x.outcome.toNumber()
                }
            })
            return games;
        });
}

async function loadGamesFromSoccerApi(storageGames) {
    const { backward, forward } = timeRange(new Date(), 60*60*24, 60*60*24);
    const backwardString = backward.toISOString().split('T').at(0);
    const forwardString = forward.toISOString().split('T').at(0);

    const instance = axios.create({
        baseURL: 'http://api.football-data.org/',
        timeout: 30000,
        headers: { 'X-Auth-Token': process.env.SOCCER_API_KEY }
    });

    await instance.get('/v2/matches/', {
        params: {
            limit: 50,
            dateFrom: backwardString,
            dateTo: forwardString,
        }
    }).then(async (res) => {
        console.log("Got answer from soccer API: " + res.status);
        console.log(res.headers['x-requests-available-minute'] + " requests left. Reset in "
            + res.headers['x-requestcounter-reset'] + " seconds");
        console.log();

        let transactions = 0;
        const batch = Tezos.contract.batch();
        const contract = await Tezos.contract.at(process.env.TEZBET_CONTRACT);

        // Sequential execution to prevent errors when creating games at the same time.
        for (const game of res.data.matches) {
            console.log("=== Loading game " + game.id + " " + game.homeTeam.name + " - " + game.awayTeam.name);

            if (!(game.id in storageGames)) {
                console.log("Creating game");

                transactions++;
                batch.withContractCall(contract.methodsObject.new_game({
                    game_id: game.id.toString(),
                    team_a: normalize(game.homeTeam.name),
                    team_b: normalize(game.awayTeam.name),
                    match_timestamp: Math.round(Date.parse(game.utcDate) / 1000).toString(),
                }))
            } else {
                console.log("Already exists");
            }

            if (game.status === "FINISHED" && (!(game.id in storageGames) || storageGames[game.id].outcome === -1)) {
                let winner = -1;
                switch(game.score.winner) {
                    case "HOME_TEAM":
                        winner = 0;
                        break;
                    case "AWAY_TEAM":
                        winner = 1;
                        break;
                    case "DRAW":
                        winner = 2;
                        break
                }

                if (winner === -1) {
                    console.log("Error updating game: invalid winner " + game.score.winner);
                } else {
                    console.log("Winner " + game.score.winner);

                    transactions++;
                    batch.withContractCall(contract.methodsObject.set_outcome({
                        game_id: game.id.toString(10),
                        choice: winner,
                    }));
                }
            }
            console.log();
        }

        if (transactions > 0) {
            console.log("Sending batch transaction...");
            await batch.send()
            .then((op) => op.confirmation())
            .then(() => console.log("Successfully sent batch transaction"))
            .catch(console.log);
        } else {
            console.log("Nothing to be done");
        }
    });
}

async function main() {
    console.log("Launching update cycle");
    await TezosSelfSign();
    console.log("Set faucet private key as signer provider");

    const storedGames = await loadContractStorage();
    console.log("Loaded stored games from contract");

    await loadGamesFromSoccerApi(storedGames);
    console.log("Done");
}

module.exports = {main: main, timeRange: timeRange};