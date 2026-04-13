/**
 * OrderService - orchestrates order creation using PaymentService and AnalyticsService
 */

import { charge, ChargeRequest, ChargeResult, PaymentDeclined } from "./payment-service.js";
import { track, TrackEvent, formatEvent } from "./analytics-service.js";

export interface Order {
  orderId: string;
  customerId: string;
  amount: number;
  currency: string;
  status: "completed" | "failed";
  transactionId?: string;
  failureReason?: string;
}

/**
 * Creates an order by charging the customer and tracking the event.
 * Calls charge() from PaymentService and track() from AnalyticsService.
 */
export function createOrder(
  customerId: string,
  amount: number,
  currency: string = "USD"
): Order {
  const orderId = `order_${Date.now()}`;

  const chargeRequest: ChargeRequest = { amount, currency, customerId };

  try {
    const result: ChargeResult = charge(chargeRequest);

    const event: TrackEvent = {
      eventName: "order_completed",
      userId: customerId,
      properties: { orderId, amount, currency, transactionId: result.transactionId },
    };
    track(event);

    // Log the formatted event (tests arrow function call graph resolution)
    const _formatted = formatEvent(event);

    return {
      orderId,
      customerId,
      amount,
      currency,
      status: "completed",
      transactionId: result.transactionId,
    };
  } catch (err) {
    const reason = err instanceof PaymentDeclined ? err.reason : "Unknown error";

    const event: TrackEvent = {
      eventName: "order_failed",
      userId: customerId,
      properties: { orderId, amount, currency, reason },
    };
    track(event);

    return {
      orderId,
      customerId,
      amount,
      currency,
      status: "failed",
      failureReason: reason,
    };
  }
}
