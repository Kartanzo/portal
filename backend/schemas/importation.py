from pydantic import BaseModel
from typing import Optional, List


class ImportationItem(BaseModel):
    cod_item: str
    quantidade: float
    data_chegada: Optional[str] = None


class ImportationCalculateRequest(BaseModel):
    items: Optional[List[ImportationItem]] = None
    history_id: Optional[str] = None
