from datetime import *
from enum import *
from pydantic import *

class Group(str, Enum):
    critical = "critical" # Критические (priorityId = 4, кроме stateId = 20)
    coordinators = "coordinators" # Назначенные на координаторов
    high_priority = "high_priority" # Высокий приоритет (priorityId = 3, кроме stateId = 20)
    investigation = "investigation"  # Исследовательские ситуации (stateId = 20)

GROUP_META = {
    Group.critical: {
        "title": "Критические",
        "icon": "🔴"
    },
    Group.coordinators: {
        "title": "На координаторах", 
        "icon": "🟣"
    },
    Group.high_priority: {
        "title": "Высокий приоритет", 
        "icon": "🟠"
    },
    Group.investigation: {
        "title": "Исследование", 
        "icon": "🔵"
    }
}

class Incident(BaseModel):
    id: str
    product: str | None = None
    service: str | None = None
    scenario: str | None = None
    created_at: datetime | None = None
    deadline: datetime | None = None
    completed_at: datetime | None = None
    assignee: str | None = None
    assigned_team: str | None = None
    initiator: str | None = None
    state: str | None = None
    state_id: str | None = None
    priority: str | None = None
    priority_id: str | None = None
    impact_id: int | None = None # Влияние (от 1 до 4). 4 - наивысшее
    urgency_id: int | None = None # Срочность (от 1 до 4). 4 - наивысшее
    header: str | None = None
    short_description: str | None = None
    description: str | None = None 
    solutuion: str | None = None 
    service_type: str | None = None # Клиентские, пользовательский, технологический
    is_need_up: bool = False # После решения - устранить проблему
    is_master: bool = False # К нему привязаны дублированные инциденты
    is_double: bool = False # Инцидент с такой причиной уже зарегестрирован
    is_effect: bool = False # Причина дочерних инцидентов
    is_reason: bool = False # Является дочерним инцидентом
    itsm_url: str | None = None
    groups: list[Group] = Field(default_factory=list) # В каких группах инцидент может быть (в нескольких может)
    is_active: bool = True
    crit_scale: int = 0 # Шкала критичности = impact (влияние) * urgency (срочность), от 1 до 16
    reccurence: int = 0 # Сколько инцидентов того же вида (service + scenario)
    escalation_risk: float = 0.0 # От 0 до 1 - риск перерасти в критический
    breach_risk: float = 0.0 # От 0 до 1 - риск сорвать срок (deadline)
    attention_score: float = 0.0 # Единый приоритет внимания; у решённых = 0
    needs_action: bool = False # требует действия координатора прямо сейчас
    action_reason: str | None = None # почему требует действия (самая срочная причина)
    age_min: int | None = None # возраст инцидента, минут
    summary: str | None = None # ИИ-выжимка «что произошло»
    suggested_team: str | None = None # ИИ-подсказка, в какую команду передать
    suggested_reason: str | None = None # обоснование подсказки