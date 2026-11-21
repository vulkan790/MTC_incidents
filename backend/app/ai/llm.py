"""LLM-слой - только текст и по запросу, не на каждый инцидент.

Провайдер выбирается переменной LLM_PROVIDER:
  - "gigachat" - GigaChat (Sber);
  - "qwen" - Qwen через OpenAI-совместимый эндпоинт (облако DashScope ИЛИ локальный Ollama/vLLM);
  - "off" - только офлайн-шаблоны;
  - "auto" - (по умолчанию) берём gigachat, если есть ключ, иначе qwen, иначе off.

Без ключей всё отдаёт офлайн-шаблон, поэтому скелет и демо работают без сети.
Для active-инцидентов не доверяем полю solution: у статусов «Назначен»/«Выполняется»
там прошлое не помогшее решение (менторы, и местами не вычищено).

Настройка GigaChat (developers.sber.ru -> GigaChat API):
    export LLM_PROVIDER=gigachat
    export GIGACHAT_CREDENTIALS="<Authorization key>"
    pip install gigachat

Настройка Qwen - вариант А, локально через Ollama (проще всего, без лимитов):
    ollama pull qwen2.5:7b && ollama serve
    export LLM_PROVIDER=qwen
    export QWEN_BASE_URL="http://localhost:11434/v1"
    export QWEN_API_KEY="ollama" 
    export QWEN_MODEL="qwen2.5:7b"
    pip install openai
"""

import os
from ..models import Incident

_PROVIDER = os.environ.get("LLM_PROVIDER", "auto").lower()

_GIGA_CREDS = os.environ.get("GIGACHAT_CREDENTIALS")
_GIGA_SCOPE = os.environ.get("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
_GIGA_VERIFY_SSL = os.environ.get("GIGACHAT_VERIFY_SSL", "0") == "1"

_QWEN_KEY = os.environ.get("QWEN_API_KEY")
_QWEN_BASE = os.environ.get("QWEN_BASE_URL", "http://localhost:11434/v1")
_QWEN_MODEL = os.environ.get("QWEN_MODEL", "qwen2.5:7b")

def _active_provider() -> str:
    if _PROVIDER in ("gigachat", "qwen", "off"):
        return _PROVIDER
    if _GIGA_CREDS:
        return "gigachat"
    if _QWEN_KEY:
        return "qwen"
    return "off"

def _ask_gigachat(prompt: str) -> str:
    from gigachat import GigaChat

    with GigaChat(credentials=_GIGA_CREDS, scope=_GIGA_SCOPE, verify_ssl_certs=_GIGA_VERIFY_SSL) as giga:
        return giga.chat(prompt).choices[0].message.content.strip()

def _ask_qwen(prompt: str) -> str:
    from openai import OpenAI

    client = OpenAI(api_key=_QWEN_KEY or "ollama", base_url=_QWEN_BASE)
    resp = client.chat.completions.create(
        model=_QWEN_MODEL,
        max_tokens=120,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.choices[0].message.content.strip()

def _ask(prompt: str) -> str:
    provider = _active_provider()
    if provider == "gigachat":
        return _ask_gigachat(prompt)
    if provider == "qwen":
        return _ask_qwen(prompt)
    raise RuntimeError("LLM provider is off")

def summarize(inc: Incident) -> str:
    base = inc.short_description or inc.header or "-"
    fallback = f"{inc.priority}: {inc.product} - {base}"
    if _active_provider() == "off":
        return fallback
    try:
        return _ask(
            "Ты помощник дежурного координатора массовых инцидентов МТС. "
            "Одной короткой фразой, по делу, без воды опиши суть инцидента.\n"
            f"Продукт: {inc.product}. Сервис: {inc.service}. Заголовок: {inc.header}. "
            f"Приоритет: {inc.priority}. Статус: {inc.state}."
        )
    except Exception:
        return fallback

def polish_instruction(text: str) -> str:
    if _active_provider() == "off":
        return text
    try:
        return _ask("Перепиши инструкцию для координатора кратко, по пунктам, деловым тоном, ничего не добавляя от себя:\n" + text)
    except Exception:
        return text