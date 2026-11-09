# Structure Lens (MnemoNexus add-on engine)

Practise pointing at the right thing. Name the hidden labels on a figure, or turn a real 3D structure and click the feature asked for.

The 3D structures in `assets/structures/` are public RCSB PDB entries (CC0). The viewer is 3Dmol.js (BSD-3-Clause; its notice is in
`assets/licenses/`). Figures and label sets are data files.

## What is, and is not, in this repository

This repository is the **engine and its tests**. It does **not** include any practice content: the activities that
drive it were written from university course material (lecture slides, worksheets and past papers), which is not ours
to publish, so `content/ and assets/fig/` is deliberately empty. Without content the add-on shows nothing to practise, and
tests that load content will not pass. To use the engine, write your own activities for your own subject.

It is built with the [MnemoNexus add-on kit](https://github.com/mnemonexus/mnx-addon-kit). The scripts expect the kit
checked out as a sibling folder named `mnx-addon-kit-release`; adjust the paths in `package.json` if you keep it elsewhere.

## Licence

MIT, see [LICENSE](LICENSE).
