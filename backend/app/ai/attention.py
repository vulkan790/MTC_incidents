"""Управление вниманием координатора - ядро нюанса «ничего не упустить».
Идея: от скорости реакции координатора зависит скорость решения, поэтому
а) Каждый активный инцидент получает единый балл внимания у каждого инцидента (attention_score) - ничто не остаётся неотсортированным и невидимым;
б) Выделяем инциденты, которые требуют действия сейчас (не просто смотреть), с конкретной причиной - координатор сразу видит, за что хвататься;
в) Ловим тихие предкритические - те, что не кричат, но вот-вот рванут."""

from datetime import datetime, timezone
from ..models import Group, Incident

def age_minutes(inc: Incident) -> float | None:
    if not inc.created_at:
        return None
    c = inc.created_at
    if c.tzinfo is None:
        c = c.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - c).total_seconds() / 60.0

# Единый приоритет внимания. Решённые = 0 (не требуют внимания).
def score(inc: Incident) -> float:
    if not inc.is_active:
        return 0.0
    s = 0.0
    if Group.critical in inc.groups:
        s += 50
    s += 40 * inc.breach_risk
    s += 25 * inc.escalation_risk
    if Group.coordinators in inc.groups:
        s += 30
    if Group.investigation in inc.groups and Group.coordinators in inc.groups:
        s += 10
    if inc.recurrence > 1:
        s += 5 * min(inc.recurrence, 4)
    if inc.is_master:
        s += 10
    return round(s, 1)

def action(inc: Incident) -> tuple[bool, str | None]:
    if not inc.is_active:
        return False, None
    if Group.critical in inc.groups and Group.coordinators in inc.groups:
        return True, "Критический на координаторах — срочно передать в команду"
    if inc.breach_risk >= 0.9:
        return True, "Срок почти истёк — эскалировать/ускорить"
    if Group.coordinators in inc.groups:
        return True, "Назначен на координаторов — передать в команду"
    if inc.escalation_risk >= 0.7 and Group.critical not in inc.groups:
        return True, "Тихий предкритический: высокий риск перерасти в критический — вмешаться заранее"
    return False, None