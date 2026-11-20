from collections import *
from .. import config
from ..models import Incident

def _minutes_to_deadline(inc: Incident) -> float | None:
    if not inc.deadline:
        return None
    due = inc.deadline
    if due.tzinfo is None:
        due = due.replace(tzinfo=timezone.utc)
    return (due - datetime.now(timezone.utc)).total_seconds() / 60.0

def breach_risk(inc: Incident) -> float:
    if not inc.is_active:
        return 0.0
    mins = _minutes_to_deadline(inc)
    if mins is None:
        return 0.0
    if mins <= 0:
        return 1.0
    if mins <= 30:
        return 0.9
    if mins <= 120:
        return 0.6
    if mins <= 360:
        return 0.3
    return 0.1


def escalation_risk(inc: Incident) -> float:
    # P(перерастёт в критический). Учитывает приоритет, шкалу критичности (impact * urgency), запас по SLA и частоту повторов.
    if inc.priority_id == config.CRITICAL_PRIORITY_ID:
        return 1.0
    if not inc.is_active:
        return 0.0
    base = 0.45 if inc.priority_id == config.HIGH_PRIORITY_ID else 0.15
    base += 0.03 * inc.crit_scale
    base += 0.05 * min(inc.recurrence, 4)
    return round(min(1.0, base * 0.6 + 0.4 * breach_risk(inc)), 3)