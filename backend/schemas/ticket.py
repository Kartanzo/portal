from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID
from datetime import datetime


class TicketUpdateResponse(BaseModel):
    id: UUID
    ticket_id: UUID
    user_id: Optional[UUID]
    user_name: str
    user_role: str
    message: Optional[str]
    attachment_name: Optional[str]
    attachment_path: Optional[str]
    created_at: datetime


class TicketCreate(BaseModel):
    title: str
    description: str
    status: str = 'Aberto'
    priority: str
    category: str
    requester_id: UUID
    delivery_forecast: Optional[str] = None
    attachment_name: Optional[str] = None
    attachment_base64: Optional[str] = None


class Ticket(BaseModel):
    id: Optional[UUID] = None
    title: str
    description: str
    status: str
    priority: str
    category: str
    requester_name: Optional[str] = None
    requester_sector: Optional[str] = None
    assigned_to: Optional[UUID] = None
    assigned_name: Optional[str] = None
    delivery_forecast: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    category_id: Optional[UUID] = None
    subcategory_id: Optional[UUID] = None
    subcategory: Optional[str] = None
    current_sector: Optional[str] = None
