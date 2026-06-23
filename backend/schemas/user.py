from pydantic import BaseModel, validator
from typing import Optional, Dict
from uuid import UUID


class User(BaseModel):
    id: Optional[UUID] = None
    name: str
    email: str
    role: str
    avatar: Optional[str] = None
    sector: Optional[str] = None
    managed_sectors: Optional[str] = None
    last_login: Optional[str] = None
    permissions: Optional[Dict] = {}
    notification_preferences: Optional[Dict] = {}

    @validator('role', pre=True)
    def lowercase_role(cls, v):
        return v.lower() if isinstance(v, str) else v


class UserPasswordUpdate(User):
    password: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str
    role: Optional[str] = None

    @validator('role', pre=True)
    def lowercase_role(cls, v):
        return v.lower() if isinstance(v, str) else v


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str
