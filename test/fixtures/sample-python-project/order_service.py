"""Order processing service."""
from .payment_service import PaymentProcessor
from .analytics_service import track_event
import json
import os


class OrderService:
    """Handles order creation and management."""

    def __init__(self, payment_processor: PaymentProcessor):
        self._processor = payment_processor
        self._orders = {}

    def create_order(self, items: list, customer_id: str) -> dict:
        """Create a new order."""
        order_id = f"ORD-{len(self._orders) + 1}"
        total = self._calculate_total(items)
        order = {"id": order_id, "items": items, "customer_id": customer_id, "total": total}
        self._orders[order_id] = order
        track_event("order_created", {"order_id": order_id})
        return order

    def _calculate_total(self, items: list) -> float:
        """Internal helper to calculate order total."""
        return sum(item.get("price", 0) * item.get("quantity", 1) for item in items)

    def process_payment(self, order_id: str) -> bool:
        """Process payment for an order."""
        order = self._orders.get(order_id)
        if not order:
            raise ValueError(f"Order {order_id} not found")
        return self._processor.charge(order["total"], order["customer_id"])


def get_order_status(order_id: str) -> str:
    """Get the status of an order."""
    return "pending"


_internal_cache = {}
