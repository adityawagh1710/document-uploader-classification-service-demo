{{/*
Common labels applied to every resource in this chart.
*/}}
{{- define "convert-worker.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: classification-service
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{/*
Selector labels — minimal and stable across upgrades.
*/}}
{{- define "convert-worker.selector" -}}
app: convert-worker
{{- end -}}

{{/*
Resolve the target namespace.
*/}}
{{- define "convert-worker.namespace" -}}
{{- required "values.namespace.name is required" .Values.namespace.name -}}
{{- end -}}

{{/*
ServiceAccount name. Default = "convert-worker"; override via values.serviceAccount.name.
*/}}
{{- define "convert-worker.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default "convert-worker" .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Fully-qualified image. Fails fast at template time when required values
were omitted by the operator.
*/}}
{{- define "convert-worker.image" -}}
{{- $repo := required "values.image.repository is required (set via --set image.repository=...)" .Values.image.repository -}}
{{- $tag  := required "values.image.tag is required (set via --set image.tag=...)" .Values.image.tag -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
