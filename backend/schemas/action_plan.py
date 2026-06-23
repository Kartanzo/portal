from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID


class ActionPlanItemCreate(BaseModel):
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


class ActionPlanCreate(BaseModel):
    sector: str
    objective: str
    macro_theme: str  # New required field
    created_by: Optional[UUID] = None


class ActionPlanUpdate(BaseModel):
    objective: Optional[str] = None
    macro_theme: Optional[str] = None  # Allow updating it
