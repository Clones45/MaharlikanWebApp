
/* ==========================================
   CONTESTABILITY LOGIC
   ========================================== */
function calculateContestability(dateJoined, collections) {
    if (!dateJoined) return 0;

    // Sort collections by date (just to be safe, though usually ordered)
    const sorted = [...collections].sort((a, b) => new Date(a.date_paid) - new Date(b.date_paid));

    // 1. Initial Reference: Date Joined
    let effectiveStartDate = new Date(dateJoined);
    let lastActivityDate = new Date(dateJoined);

    // 2. Iterate Payments to check for Gaps (Lapses)
    sorted.forEach(col => {
        const paymentDate = new Date(col.date_paid);
        if (isNaN(paymentDate.getTime())) return;

        // Calculate Gap from PREVIOUS activity
        // Logic: (YearDiff * 12) + MonthDiff
        let monthsDiff = (paymentDate.getFullYear() - lastActivityDate.getFullYear()) * 12;
        monthsDiff += paymentDate.getMonth() - lastActivityDate.getMonth();

        // Also adjust for day of month (optional, but "month-based" usually ignores days)
        // User said: "if the member became lapsed or hasn't paid on the last 3 months"
        // Let's stick to pure month difference for simplicity, or approximate.

        if (monthsDiff >= 3) {
            // LAPSE DETECTED!
            // Restart contestability from this new payment date (Reinstatement)
            effectiveStartDate = paymentDate;
        }

        lastActivityDate = paymentDate;
    });

    // 3. Calculate Period from Effective Start to NOW
    const now = new Date();
    let currentMonths = (now.getFullYear() - effectiveStartDate.getFullYear()) * 12;
    currentMonths += now.getMonth() - effectiveStartDate.getMonth();

    // Adjust day? "contestability period is not based on the payment but on the month the member stays"
    // So simple month diff is likely sufficient.

    // 4. Cap at 12
    if (currentMonths < 0) currentMonths = 0;
    if (currentMonths > 12) currentMonths = 12;

    return currentMonths;
}

// Export for Node.js testing environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calculateContestability };
}
