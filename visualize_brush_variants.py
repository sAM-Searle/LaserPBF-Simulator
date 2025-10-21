import os
import numpy as np
import matplotlib.pyplot as plt

# Path to the folder containing the CSV files
FOLDER = 'array_thermalbrush'

# List all CSV files in the folder, sorted by index
csv_files = sorted([
    f for f in os.listdir(FOLDER)
    if f.startswith('brush_variant_') and f.endswith('.csv')
], key=lambda x: int(x.split('_')[-1].split('.')[0]))

# Load all arrays first to determine global vmin/vmax
arrays = [np.loadtxt(os.path.join(FOLDER, csv_file), delimiter=',') for csv_file in csv_files]
global_min = min(arr.min() for arr in arrays)
global_max = max(arr.max() for arr in arrays)

# Plot each brush variant with shared colorbar
fig, axes = plt.subplots(1, len(arrays), figsize=(3*len(arrays), 3))
# Ensure axes is always a list for iteration
if len(arrays) == 1:
    axes = [axes]

ims = []
for idx, (arr, ax) in enumerate(zip(arrays, axes)):
    im = ax.imshow(arr, cmap='hot', interpolation='nearest', vmin=global_min, vmax=global_max)
    ims.append(im)
    ax.set_title(f'Variant {idx}')
    ax.axis('off')

# Add a single colorbar for all subplots
cbar = fig.colorbar(ims[0], ax=axes if len(arrays) > 1 else axes[0], orientation='vertical', fraction=0.046, pad=0.04)

plt.tight_layout()
plt.show()
