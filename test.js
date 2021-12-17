const server = require('./server');
const assert = require('assert').strict;

function testTimeRange() {
    console.log("Testing timeRange");
    const date = new Date("December 31, 2021 18:04:36");
    const { backward, forward } = server.timeRange(date, 60*60*24, 60*60*24);

    assert(backward.toISOString() === new Date("December 30, 2021 18:04:36").toISOString());
    assert(forward.toISOString() === new Date("January 1, 2022 18:04:36").toISOString());
}

testTimeRange();