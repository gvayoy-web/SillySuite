from datetime import datetime
from flask import Blueprint, jsonify, Response
from silly.globals import container

export_bp = Blueprint("export", __name__, url_prefix="/api/exportar")


@export_bp.route("/resultados", methods=["GET"])
def exportar_resultados():
    with container.state.lock:
        puntos = dict(container.state.puntos)
        actividad = list(container.state._actividad)
        modo = container.state.modo
    ranking = sorted([{"grupo": k, "puntos": v} for k, v in puntos.items()], key=lambda x: x["puntos"], reverse=True)
    return jsonify({"fecha": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "modo": modo, "puntos": puntos, "ranking": ranking, "actividad": actividad})


@export_bp.route("/resultados/csv", methods=["GET"])
def exportar_resultados_csv():
    with container.state.lock:
        puntos = dict(container.state.puntos)
        modo = container.state.modo
    ranking = sorted([{"grupo": k, "puntos": v} for k, v in puntos.items()], key=lambda x: x["puntos"], reverse=True)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    mode_names = {"preguntas": "Preguntas", "verses": "Tiempo", "roulette": "Ruleta", "hangman": "Ahorcado", "battle": "Batalla", "survival": "Supervivencia", "quizshow": "Quiz Show"}
    modo_label = mode_names.get(modo, modo or "General")
    lines = [f"Modo,{modo_label}"]
    lines.append(f"Fecha,{ts}")
    lines.append("")
    lines.append("Posición,Grupo,Puntaje")
    for i, r in enumerate(ranking, 1):
        lines.append(f'{i},"{r["grupo"]}",{r["puntos"]}')
    lines.append("")
    lines.append(f'Total Grupos,{len(ranking)}')
    if ranking:
        lines.append(f'Máximo Puntaje,{ranking[0]["puntos"]}')
        lines.append(f'Puntaje Promedio,{sum(r["puntos"] for r in ranking) / len(ranking):.1f}')
    csv = "\r\n".join(lines)
    return Response(
        csv,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="resultados_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv"'},
    )


@export_bp.route("/resultados/imagen", methods=["GET"])
def exportar_resultados_imagen():
    with container.state.lock:
        puntos = dict(container.state.puntos)
        actividad = list(container.state._actividad)
    ranking = sorted([{"grupo": k, "puntos": v} for k, v in puntos.items()], key=lambda x: x["puntos"], reverse=True)
    icons = ["🥇", "🥈", "🥉", "🏅"]
    cards = ""
    for i, r in enumerate(ranking):
        color = "#FFD700" if i == 0 else "#C0C0C0" if i == 1 else "#CD7F32" if i == 2 else "#fff"
        tc = "#000" if i < 3 else "#333"
        icon = icons[i] if i < len(icons) else "🏅"
        cards += f'<div style="background:{color};border:4px solid #000;padding:20px 30px;text-align:center;min-width:200px;border-radius:4px;"><div style="font-size:3rem;">{icon}</div><div style="font-size:2rem;font-weight:900;color:{tc};">{r["grupo"]}</div><div style="font-size:3rem;font-weight:900;color:{tc};">{r["puntos"]} pts</div><div style="font-size:1.2rem;font-weight:700;color:{tc};background:#000;color:#fff;display:inline-block;padding:2px 16px;margin-top:4px;">#{i+1}</div></div>'
    act_html = ""
    for a in actividad[-10:]:
        act_html += f'<div style="padding:4px 0;border-bottom:1px solid #0003;font-size:0.9rem;">{a}</div>'
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    html = f'''<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Resultados - SillyQuiz</title><style>body{{font-family:'Segoe UI',sans-serif;background:#0038ff;display:flex;flex-direction:column;align-items:center;min-height:100vh;margin:0;padding:40px;}}h1{{color:#FFD700;font-size:3rem;text-shadow:4px 4px 0 #000;margin-bottom:10px;}}.date{{color:#fff;font-size:1rem;margin-bottom:30px;opacity:0.8;}}.podium{{display:flex;gap:20px;align-items:flex-end;flex-wrap:wrap;justify-content:center;margin-bottom:40px;}}.actividad{{background:#fff1;border:2px solid #000;padding:16px 24px;max-width:600px;width:100%;color:#fff;font-size:0.9rem;}}</style></head><body><h1>🏆 RESULTADOS FINALES</h1><div class="date">{ts}</div><div class="podium">{cards}</div><div class="actividad"><div style="font-weight:700;font-size:1.2rem;margin-bottom:8px;">📋 Actividad reciente</div>{act_html}</div></body></html>'''
    return Response(html, mimetype="text/html; charset=utf-8")
