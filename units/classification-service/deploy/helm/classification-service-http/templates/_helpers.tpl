{{/* Common labels on every resource. */}}
{{- define "classification-service-http.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: classification-service
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{/* Selector labels — minimal + stable across upgrades. */}}
{{- define "classification-service-http.selector" -}}
app: classification-service-http
{{- end -}}

{{/* Target namespace (required). */}}
{{- define "classification-service-http.namespace" -}}
{{- required "values.namespace.name is required" .Values.namespace.name -}}
{{- end -}}

{{/* ServiceAccount name. */}}
{{- define "classification-service-http.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default "classification-service-http" .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Fully-qualified image; fails fast when required values are omitted. */}}
{{- define "classification-service-http.image" -}}
{{- $repo := required "values.image.repository is required (set via --set image.repository=...)" .Values.image.repository -}}
{{- $tag := required "values.image.tag is required (set via --set image.tag=...)" .Values.image.tag -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
