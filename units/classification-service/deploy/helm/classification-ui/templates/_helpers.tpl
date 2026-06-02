{{/*
Common labels applied to every resource in this chart.
*/}}
{{- define "classification-ui.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: classification-service
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{/*
Per-component selector labels — must remain stable across upgrades, so we
keep them minimal (no chart version/instance fields).
*/}}
{{- define "classification-ui.uiSelector" -}}
app: classification-ui
{{- end -}}

{{- define "classification-ui.localstackSelector" -}}
app: localstack
{{- end -}}

{{/*
Resolve the target namespace from values.namespace.name.
*/}}
{{- define "classification-ui.namespace" -}}
{{- required "values.namespace.name is required" .Values.namespace.name -}}
{{- end -}}

{{/*
ServiceAccount name. When serviceAccount.create=true the chart creates and
uses this SA (default name "classification-ui"); otherwise the pod falls back
to the namespace "default" SA — LocalStack mode needs no AWS identity.
*/}}
{{- define "classification-ui.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default "classification-ui" .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Fully-qualified image reference. Fails fast with a useful message at
template time when the operator forgot --set image.repository / image.tag.
*/}}
{{- define "classification-ui.image" -}}
{{- $repo := required "values.image.repository is required (set via --set image.repository=...)" .Values.image.repository -}}
{{- $tag  := required "values.image.tag is required (set via --set image.tag=...)" .Values.image.tag -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
