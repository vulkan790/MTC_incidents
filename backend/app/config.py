import os

DATA_FILE = os.environ.get("INCIDENTS_FILE", os.path.join(os.path.dirname(__file__), "..", "data", "incidents.json"))
ATTRIBUTES_FILE = os.environ.get("ATTRIBUTES_FILE", os.path.join(os.path.dirname(__file__), "..", "data", "incidents_attributes.json"))

POLL_INTERVAL_SEC = float(os.environ.get("POLL_INTERVAL_SEC", "1.0"))

ITSM_URL_TEMPLATE = "http://itsm.mts.local/incident/{id}"

# Наше поле -> ключ в JSON
FIELD_MAP = {
    "id": "id",
    "product": "productName",
    "service": "service",
    "scenario": "scenarioName",
    "created_at": "submitDate",
    "completed_at": "completionDate",
    "deadline": "deadline",
    "assignee": "assignedEmployee",
    "assigned_team": "assignedGroupName",
    "initiator": "initiatorName",
    "state": "state",
    "state_id": "stateId",
    "priority": "priority",
    "priority_id": "priorityId",
    "impact_id": "impactId",
    "urgency_id": "urgencyId",
    "header": "header",
    "short_description": "shortDescription",
    "description": "description",
    "solution": "solution",
    "service_type": "serviceType",
    "is_need_up": "isNeedUp",
    "is_master": "isMaster",
    "is_double": "isDouble",
    "is_effect": "isEffect",
    "is_reason": "isReason"
}

COORDINATORS_TEAM = "КЦ ИТ Координаторы Массовых Инцидентов"

CRITICAL_PRIORITY_ID = 4 # Наивысший приоритетный ID (данные с incidents.json)
HIGH_PRIORITY_ID = 3 # Высокий приоритетный ID (данные с incidents.json)

INVESTIGATION_STATE_IDS = { 20 } # Исследование ситуации (данные с incidents.json)
CLOSED_STATE_IDS = { 7, 10 } # Завершён и закрыт - неактивные (данные с incidents.json)

STATE_LABELS = {
    0: "Назначен", 2: "Выполняется", 7: "Завершён", 10: "Закрыт", 20: "Исследование ситуации"
}