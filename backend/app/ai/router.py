# ИИ-эндпоинты
from fastapi import *
from ..store import store
from . import analysis, llm, pipeline

router = APIRouter(prefix="/api")

# Очередь внимания «что хватать прямо сейчас» - ядро «ничего не упустить»
@router.get("/attention")
async def attention_queue(limit: int = 10):
    items = sorted(store.all(), key=lambda i: i.attention_score, reverse=True)
    queue = [i for i in items if i.needs_action]
    return {
        "need_action_count": len(queue),
        "active_count": sum(1 for i in items if i.is_active),
        "top": queue[0].model_dump(mode="json") if queue else None,
        "queue": [i.model_dump(mode="json") for i in queue[:limit]]
    }

# ИИ-помощь по инциденту: выжимка + подсказка команды + итоговая инструкция.
@router.post("/incidents/{iid}/analyze")
async def analyze(iid: str):
    inc: store.get(iid)
    if not inc:
        return {"error": "not found"}
    team, reason = analysis.suggest_team(inc, pipeline.state["routing_index"])
    inc.suggested_team, inc.suggested_reason = team, reason
    inc.summary = llm.summarize(inc)
    return {
        "id": iid,
        "summary": inc.summary,
        "suggested_team": team,
        "recurrence": inc.recurrence,
        "crit_scale": inc.crit_scale,
        "instruction": analysis.final_instruction(inc, team, reason),
    }