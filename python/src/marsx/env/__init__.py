"""MarsX/Jezero-v1 Gymnasium environments.

    gym.make("marsx.env:MarsX/Jezero-v1", scenario="jezero-v1/l1/rtg-geometry")
    gym.make_vec("marsx.env:MarsX/Jezero-v1", num_envs=4096, vectorization_mode="vector_entry_point")

The ``module:id`` form imports this module, which registers the id.
"""

import gymnasium as gym

ENV_ID = "MarsX/Jezero-v1"

if ENV_ID not in gym.registry:
    gym.register(
        id=ENV_ID,
        entry_point="marsx.env.single:JezeroEnv",
        vector_entry_point="marsx.env.vector:JezeroVecEnv",
    )
