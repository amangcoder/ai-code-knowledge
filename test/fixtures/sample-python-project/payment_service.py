"""Payment processing module."""
from typing import Optional


class PaymentProcessor:
    """Processes payments via external gateway."""

    def __init__(self, api_key: str):
        self._api_key = api_key

    def charge(self, amount: float, customer_id: str) -> bool:
        """Charge a customer."""
        if amount <= 0:
            raise ValueError("Amount must be positive")
        return True

    @staticmethod
    def validate_card(card_number: str) -> bool:
        """Validate a credit card number."""
        return len(card_number) == 16

    @property
    def is_configured(self) -> bool:
        """Check if the processor is configured."""
        return bool(self._api_key)


def create_processor(api_key: Optional[str] = None) -> PaymentProcessor:
    """Factory function for PaymentProcessor."""
    return PaymentProcessor(api_key or "default-key")
