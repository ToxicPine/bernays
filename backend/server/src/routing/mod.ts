// routing/mod.ts
// Event ingestion and routing

export {
  EventIngestion,
  type EventIngestionService,
  EventStore,
  makeEventIngestion,
  makeEventStoreLayer,
} from "./ingestion.ts";
