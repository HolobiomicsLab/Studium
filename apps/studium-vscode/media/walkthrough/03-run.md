# Run a reproduction

Some scenes ask you to **reproduce a real scientific operation**. The operation is the *vehicle*; a
calibrated judgment is the *destination*.

- On a reproduction scene, click **Run the reproduction** in the lesson pane (also in the Studium sidebar).
- Studium first shows you a window with the **exact command**, the **packages to install** and the **folder**
  it runs in. Nothing starts until you confirm. **"Run and trust this course"** remembers that choice for
  this exact version of the course; any change to the course asks again.
- The capsule installs and runs **in your workspace folder**, and Studium itself never executes anything.
  A run folder that is an absolute path or leaves the workspace (`..`) is refused.
- The **landmark** YOU produce (for example `MODIFIED_COSINE=0.6477`) grounds the next judgment scene.

After the run, Studium tells you whether your run is **attested** (it grounds the judgment) or
**quarantined** (inconsistent with the declared manifest; the judgment then uses the reference run).

> "Attested" means consistent with the declared manifest, **not** "authenticated": attestation is
> structural, not cryptographic.
