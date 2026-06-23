from pydantic import BaseModel, validator
from typing import Optional, Dict
from uuid import UUID
from datetime import datetime


class Notification(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    message: str
    link: Optional[str]
    is_read: bool
    created_at: datetime


class NotificationPreferences(BaseModel):
    email: bool = True
    sound: bool = True
    desktop: bool = True


class RolePermissionsUpdate(BaseModel):
    role: str
    permissions: Dict
