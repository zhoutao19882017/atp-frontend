import { HoppRESTRequest, RESTReqSchemaVersion } from "@hoppscotch/data"

export const getDefaultRESTRequest = (): HoppRESTRequest => ({
  v: RESTReqSchemaVersion,
  endpoint: "",
  name: "Untitled",
  params: [],
  headers: [],
  method: "GET",
  auth: {
    authType: "inherit",
    authActive: true,
  },
  preRequestScript: "",
  testScript: "",
  body: {
    contentType: null,
    body: null,
  },
  requestVariables: [],
})
