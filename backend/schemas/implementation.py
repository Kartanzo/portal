from pydantic import BaseModel, field_validator
from typing import Optional, List, Union


class ImplementationScheduleCreate(BaseModel):
    sector: str
    objective: str
    macro_theme: Optional[str] = None


class ImplementationScheduleUpdate(BaseModel):
    objective: Optional[str] = None
    macro_theme: Optional[str] = None


class ImplementationScheduleItemCreate(BaseModel):
    actions: str
    expected_result: str
    projects: str
    responsible: List[str]
    status: str
    schedule_start: str
    schedule_end: str
    observation: Optional[str] = None
    budget_planned: Optional[float] = 0.0
    budget_actual: Optional[float] = 0.0
    hours_planned: Optional[int] = 0
    hours_actual: Optional[int] = 0
    roi_percentage: Optional[float] = 0.0
    stakeholder_satisfaction: Optional[int] = 0


class ImplementationScheduleItemUpdate(BaseModel):
    actions: Optional[str] = None
    expected_result: Optional[str] = None
    projects: Optional[str] = None
    responsible: Optional[List[str]] = None
    status: Optional[str] = None
    schedule_start: Optional[str] = None
    schedule_end: Optional[str] = None
    observation: Optional[str] = None
    budget_planned: Optional[float] = None
    budget_actual: Optional[float] = None
    hours_planned: Optional[int] = None
    hours_actual: Optional[int] = None
    roi_percentage: Optional[float] = None
    stakeholder_satisfaction: Optional[int] = None
    waiting_for_return: Optional[List[str]] = None
    blocked_by_user_id: Optional[str] = None

    @field_validator('waiting_for_return', mode='before')
    @classmethod
    def convert_waiting_for_return(cls, v):
        # Mantém sempre como array para compatibilidade com text[] no PostgreSQL
        if isinstance(v, bool):
            return []  # Converte boolean para array vazio
        if isinstance(v, list):
            return v
        if v is None:
            return None
        return []

    @field_validator('blocked_by_user_id', mode='before')
    @classmethod
    def convert_blocked_by_user_id(cls, v):
        # Converte string vazia para None (UUID não aceita string vazia)
        if v == '' or v is None:
            return None
        return v
