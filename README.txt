1. Метрики для сбора 
kilo_ttft_seconds{is_entry="false"} p95 — главный SLO

kilo_ttft_seconds{is_entry="true"} p95 — холодный старт

kilo_generation_tokens_per_second p5 — скорость генерации

kilo_errors rate — надёжность

kilo_empty_completion rate — скрытая деградация

k6_vus — сколько реально работает

k6_kilo_prompt_tokens avg — рост контекста

vllm:num_requests_waiting — очередь на сервере

2. Проверить smoke тест и проверить что пишутся метрики.

Smoke, 5 мин	SCENARIO=burst BURST_DURATION_SECONDS=270 SESSIONS=4
Поиск колена, <1 ч	SCENARIO=steps SESSIONS=32 STEP_DURATION_SECONDS=300 COOLDOWN_SECONDS=30 → 6×(300+30)=33 мин
Ночной soak	SCENARIO=soak SOAK_DURATION_SECONDS=28800 SESSIONS=20 → 8 ч
Быстрый burst-тест	SCENARIO=burst BURST_DURATION_SECONDS=120 SESSIONS=50 → 2.5 мин

3. Сформировать скрипт с xk6-sse
TTFT в k6-порте — это TTFB (res.timings.waiting). Для большинства OpenAI-совместимых SSE-серверов это близко к TTFT (первый чанк — уже первое событие), но если сервер шлёт : keepalive до первого токена, TTFT будет завышен. Если нужен точный TTFT и межтокенные интервалы — соберите k6 с xk6-sse (xk6 build --with github.com/phymbert/xk6-sse), тогда SSE разбирается потоково.

4. Сформировать скрипт на 6-8 часов нагрузки.

В случае если не выйдет запустить нагрузку через k6 запустить через python.