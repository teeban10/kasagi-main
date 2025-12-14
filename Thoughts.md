# KasagiEngine Begining thoughts

 - Redis will be a key storage since it should be fast
 - Websocket so keeping connection alive (NatJetstream for high scalability)
 - Player can connect and reconnect as long as room exits
 - How to make sure redis stays alive
  - Sharding and sentinels 
  - No Single Node redis
