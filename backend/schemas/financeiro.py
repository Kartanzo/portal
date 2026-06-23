from pydantic import BaseModel
from typing import Optional


class FinanceiroJustificativaCreate(BaseModel):
    base_id: int
    account_id: str
    month: int
    year: int
    text: str
    department: Optional[str] = None
