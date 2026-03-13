
const { calculateContestability } = require('../renderer/utils/contestability');

function runTest(name, dateJoined, collections, expectedMonths) {
    console.log(`Running Test: ${name}`);
    const result = calculateContestability(dateJoined, collections);
    // Allow for small off-by-one due to "now" moving or month diff calcs, but here we expect integer matches.
    if (result === expectedMonths) {
        console.log(`✅ PASSED: Expected ${expectedMonths}, Got ${result}`);
    } else {
        console.error(`❌ FAILED: Expected ${expectedMonths}, Got ${result}`);
    }
}

// Helpers
const now = new Date(); // Fixed reference would be better but this works if we use relative calc
function getMonthOffset(monthsAgo) {
    const d = new Date(now);
    d.setMonth(now.getMonth() - monthsAgo);
    return d.toISOString();
}

function generateMonthlyPayments(startMonthsAgo, endMonthsAgo) {
    const payments = [];
    for (let i = startMonthsAgo; i >= endMonthsAgo; i--) {
        payments.push({ date_paid: getMonthOffset(i) });
    }
    return payments;
}

// TEST 1: New Member (Joined 5 months ago, PAID MONTHLY)
// Should result in 5.
runTest(
    "New Member (5 months tenure, Monthly Payments)",
    getMonthOffset(5),
    generateMonthlyPayments(5, 0), // Payments at 5,4,3,2,1,0 months ago
    5
);

// TEST 2: Loyal Member (Joined 20 months ago, PAID MONTHLY)
// Should be capped at 12.
runTest(
    "Loyal Member (20 months tenure, Monthly Payments)",
    getMonthOffset(20),
    generateMonthlyPayments(20, 0),
    12
);

// TEST 3: Lapsed Member 
// Joined 20 months ago. Paid monthly until 10 months ago.
// GAP: 10 months ago -> 6 months ago (Gap = 4 months). RESET!
// Then Paid monthly from 6 months ago to now.
// Current Start = 6 months ago.
// Result = 6.
const lapsedCollections = [
    ...generateMonthlyPayments(20, 10),
    ...generateMonthlyPayments(6, 0)
];
runTest(
    "Lapsed Member (Gap 10mo->6mo)",
    getMonthOffset(20),
    lapsedCollections,
    6
);

// TEST 4: Edge Case - Gap of exactly 3 months
// Paid 5 months ago.
// Paid 2 months ago.
// Gap = 3. Reset?
// If Logic is >= 3, Result is 2 (from 2 months ago).
// If Logic is > 3, Result is 5.
// User requirement: "lapse of 3 or more months" -> So 3 IS a lapse.
// Expect Reset. Result = 2.
runTest(
    "Exact 3 Month Gap (Should Reset)",
    getMonthOffset(5),
    [
        { date_paid: getMonthOffset(5) },
        { date_paid: getMonthOffset(2) }
    ],
    2
);

// TEST 5: Edge Case - Gap of 2 months (Safe)
// Paid 5 months ago.
// Paid 3 months ago. (Gap = 2).
// Result = 5.
runTest(
    "2 Month Gap (Should NOT Reset)",
    getMonthOffset(5),
    [
        { date_paid: getMonthOffset(5) },
        { date_paid: getMonthOffset(3) }
    ],
    5
);

