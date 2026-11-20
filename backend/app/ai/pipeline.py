# Единая точка входа ИИ-слоя
from ..models import Incident
from . import analysis, attention
from .risk import breach_risk, escalation_risk

state: dict = {"routing_index": {}}

def enrich(incidents: list[Incident]) -> None:
    rec = analysis.recurrence_map(incidents)
    state["routing_index"] = analysis.build_routing_index(incidents)
    for inc in incidents:
        inc.recurrence = rec.get(analysis.key(inc), 1)
        inc.escalation_risk = escalation_risk(inc)
        inc.breach_risk = breach_risk(inc)
        age = attention.age_minutes(inc)
        inc.age_min = int(age) if age is not None else None
        inc.attention_score = attention.score(inc)
        inc.needs_action, inc.action_reason = attention.action(inc)