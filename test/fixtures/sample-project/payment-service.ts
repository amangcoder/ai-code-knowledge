/**
 * PaymentService - handles payment processing
 */

export class PaymentDeclined extends Error {
  constructor(public readonly reason: string) {
    super(`Payment declined: ${reason}`);
    this.name = "PaymentDeclined";
  }
}

export interface ChargeRequest {
  amount: number;
  currency: string;
  customerId: string;
}

export interface ChargeResult {
  transactionId: string;
  amount: number;
  currency: string;
}

/**
 * Charges a customer for the given amount.
 * Throws PaymentDeclined if the payment cannot be processed.
 */
export function charge(request: ChargeRequest): ChargeResult {
  if (request.amount <= 0) {
    throw new PaymentDeclined("Amount must be greater than zero");
  }

  if (!request.customerId) {
    throw new PaymentDeclined("Invalid customer ID");
  }

  // Simulate a declined card for test customer IDs starting with "declined-"
  if (request.customerId.startsWith("declined-")) {
    throw new PaymentDeclined("Card was declined by issuer");
  }

  return {
    transactionId: `txn_${Date.now()}`,
    amount: request.amount,
    currency: request.currency,
  };
}
