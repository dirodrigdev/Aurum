# Validation Matrix — Motores 1–7

| Test | Qué mide | Resultado | Conclusión |
| --- | --- | --- | --- |
| Preprocess before/after | Medias vs vol al recentrar historia | Medias convergen a targets; vol se preserva | Preprocess sano |
| Attribution A/B/C/D | Impacto preprocess y weighting | Weighted es palanca dominante; preprocess aporta menos | Weighting explica brecha M1 vs M2 |
| Weighted vs uniform | Sesgo del bootstrap | Weighted reduce probRuin drásticamente | M1 optimista por weighting |
| Half-life sensitivity | Robustez weighting | ProbRuin cambia 2.8–6.9% | Sensibilidad moderada |
| Block length sensitivity | Robustez M1 | ProbRuin 3.5–6.4% | M1 sensible a block length |
| Seed stability (M1–M7) | Variación Monte Carlo | Baja en 2/4/6/7; M1 penalizado por estructura | Estabilidad buena salvo estructura M1 |
| Walk-forward (M1–M7) | Calibración histórica | M1–6: dentro P10–P90; M6 mejora sesgo vs M2; M7 80% cobertura | M6 mejor centro; M7 no mejora |
| Survival metrics | DD, meses recorte | M1 cómodo; prudentes requieren más recortes | Prudentes reflejan gasto exigente |
| Reconciliación M1 vs M2 | Diferencia metodológica | Brecha por weighting y medias efectivas | Diferencia no por patrimonial |
| Motor 3 | Regímenes simples | ProbRuin ~39% | No arbitra |
| Motor 4 | Parámetros inciertos | ProbRuin ~38.8% | Prudente honesto |
| Capital sensitivity | Capital 1.4/1.9/2.5B | Riesgo cae fuerte; convergencia entre motores a 2.5B | Nivel de capital domina |
| Allocation sensitivity | RV 20/50/80 | RV alto reduce probRuin en todos | Crecimiento necesario |
| Motor 5 | Paramétrico = M2 | Igual a M2 | Sin aporte |
| Motor 6 | Central explícito | ProbRuin 32.62%; score 85.4 | Mejor centro actual |
| Motor 7 | Guided regime | ProbRuin 40.20%; score 77.0 | Confirma bloque prudente |
