# Engine

Individual engine identified by serial number.

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| serial_number | string | Engine serial number [LABEL] | ESN 738456 |
| type | EngineType | Reference | 10 |
| current_aircraft | Aircraft | [READONLY] [DAILY=EngineMount[removed_date=null OR removed_date>TODAY].aircraft] | 1001 |
| manufacture_date | date | Date of manufacture [LABEL2] | 2014-08-20 |
| total_flight_hours | int | Accumulated flight hours | 32000 |
| total_cycles | int | Accumulated cycles | 15000 |

## Data Generator

Generate 6 engines per each engine type you find in the list below: Use realisitic data for toal cacles and flight hours.

## Notes on Engine Degradation

The flight profile – the way an aircraft operates – is one of the decisive factors for engine degradation. In maintenance, this is often referred to as the "severity" of an operation.

Here are the key flight profile criteria that an IT system for maintenance planning should capture:

1. Flight-Hour-to-Cycle Ratio (FH:FC)
This is the most fundamental criterion. An engine ages in two ways: through thermal fatigue (starts) and mechanical wear (running time).

Short-Haul: A ratio of e.g. 1:1 (1 hour of flight per start). The engine frequently reaches extreme temperatures (takeoff phase) and then cools down again. This leads to thermal stress cracks.

Long-Haul: A ratio of e.g. 10:1. The engine spends a lot of time in stable "cruise" mode at lower load, which extends component life per flight hour.

2. Derated Takeoff (Flex Temp)
Engines are almost never started at 100% of available power, unless the runway is short or the aircraft is very heavy.

Criterion: What percentage of thrust was used during takeoff?

Maintenance Effect: A "Reduced Thrust Takeoff" lowers the maximum exhaust gas temperature (EGT). Even a small reduction in takeoff temperature can extend the time an engine can remain on wing by thousands of cycles.

3. Pattern Work and Training (Touch-and-Go)
During training flights, the engine is cycled up and down multiple times within a very short period without a significant cooling phase in cruise flight.

Criterion: Number of go-arounds or touch-and-go maneuvers.

Maintenance Effect: This leads to disproportionate fatigue of rotating parts (discs and shafts).

4. Reverse Thrust
After landing, the airflow is redirected to slow down the aircraft.

Criterion: Duration and intensity of use (Full Reverse vs. Idle Reverse).

Maintenance Effect: High reverse thrust often stirs up foreign objects (FOD - Foreign Object Debris) that can be ingested into the engine and damage the fan blades.

5. Flight Altitude and Atmospheric Conditions
The profile also defines which air layers the engine operates in.

Step Climbs: Does the aircraft need to change altitude multiple times during cruise (due to weight or traffic)? Each thrust change means mechanical stress.

Contaminated Air: A profile with many climbs through layers of volcanic ash, Saharan dust, or high humidity (icing risk) requires more frequent inspections of compressor blades.

6. Ground Time (Taxi Time)
Even when the aircraft is not flying, the engines are running.

Criterion: Taxi-in / Taxi-out times.

Maintenance Effect: While taxiing on the ground, engines ingest the most dirt and small stones from the surface. IT systems often calculate a correction factor for operating hours.

Summary for IT Systems
An intelligent maintenance system would export this data from the Flight Data Recorder (FDR) or the ACMS (Aircraft Condition Monitoring System) and assign each engine a "Severity Factor".

