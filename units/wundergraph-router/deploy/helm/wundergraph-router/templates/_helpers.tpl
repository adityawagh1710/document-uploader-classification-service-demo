{{/* Common labels on every resource. */}}
{{- define "wundergraph-router.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: classification-service
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{/* Selector labels — minimal + stable across upgrades. */}}
{{- define "wundergraph-router.selector" -}}
app: wundergraph-router
{{- end -}}

{{/* Target namespace (required). */}}
{{- define "wundergraph-router.namespace" -}}
{{- required "values.namespace.name is required" .Values.namespace.name -}}
{{- end -}}

{{/* ServiceAccount name. */}}
{{- define "wundergraph-router.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default "wundergraph-router" .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Fully-qualified image; fails fast when required values are omitted. */}}
{{- define "wundergraph-router.image" -}}
{{- $repo := required "values.image.repository is required (set via --set image.repository=...)" .Values.image.repository -}}
{{- $tag := required "values.image.tag is required (set via --set image.tag=...)" .Values.image.tag -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
