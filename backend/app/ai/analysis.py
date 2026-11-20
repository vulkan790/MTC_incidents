from collections import *
from .. import config
from ..models import Incident

def key(inc: Incident) -> str:
    return f"{inc.service or ''}:{inc.scenario or ''}"

def recurrence_map(incidents: list[Incident]) -> dict[str, int]:
    c = Counter(key(i) for i in incidents)
    return dict(c)

def build_routing_index(incidents: list[Incident]) -> dict[str, Counter]:
    idx: dict[str, Counter] = defaultdict(Counter)
    for i in incidents:
        team = i.assigned_team or ""
        if not team or team == config.COORDINATORS_TEAM:
            continue
        if i.product:
            idx[i.product][team] += 1
        if i.service:
            idx[i.service][team] += 1
    return idx

def suggest_team(inc: Incident, idx: dict[str, Counter]) -> tuple[str | None, str]:
    for k in (inc.product, inc.service):
        if k and idx.get(k):
            team, n = idx[k].most_common(1)[0]
            return team, f"Чаще всего инциденты по «{k}» решает {team} ({n} шт.)"
    return None, "Нет истории по этому продукту — требуется ручная маршрутизация"

def final_instruction(inc: Incident, team: str | None, reason: str) -> str:
    lines = [f"Инцидент {inc.id} · {inc.product} · {inc.state}."]
    if inc.recurrence > 1:
        lines.append(f"Повтор: вид «{inc.scenario}» встречается {inc.recurrence} раз — возможна системная причина.")
    if inc.is_master:
        lines.append("Это мастер-инцидент: к нему привязаны дубли, решение закроет цепочку.")
    if inc.is_need_up:
        lines.append("После решения требуется устранение последствий (isNeedUp).")
    if team:
        lines.append(f"Рекомендация: передать в «{team}». {reason}")
    else:
        lines.append(reason)
    return "\n".join(lines)