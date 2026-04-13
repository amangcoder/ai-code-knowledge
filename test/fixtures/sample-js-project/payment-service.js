const stripe = require('stripe');

class PaymentProcessor {
    constructor(apiKey) {
        this.apiKey = apiKey;
    }

    charge(amount, customerId) {
        if (amount <= 0) throw new Error('Amount must be positive');
        return true;
    }
}

function processPayment(amount, customerId) {
    const processor = new PaymentProcessor('default-key');
    return processor.charge(amount, customerId);
}

module.exports = { PaymentProcessor, processPayment };
