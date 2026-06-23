from pydantic import BaseModel
from typing import Optional


class InterSectorTicketCreate(BaseModel):
    title: str
    description: str
    category: str
    priority: str
    target_sector: str
    requester_id: str


class InterSectorTicketUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    delivery_forecast: Optional[str] = None
